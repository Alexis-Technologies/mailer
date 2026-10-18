/**
 * The throughput of the MongoDB outbox: how many jobs a second its workers
 * take and settle, and how many round trips each job costs, for 1 and 4
 * workers of 1 and 10 lanes, with and without a change stream. The handler
 * acknowledges at once, so what is measured is the queue alone, not a send.
 *
 * Run (manual only, outside the gates):
 *   docker compose -f tests/mongodb/docker-compose.yml up -d --wait
 *   MONGODB_URL='mongodb://localhost:27027/?replicaSet=rs0' node bench/outbox.js [jobs]
 *
 * Each worker is an outbox of its own over the collection, as a process of
 * its own would be, its caches and its change stream apart from the others.
 */

const { randomUUID } = require('node:crypto');
const { MongoClient } = require('mongodb');
const { createMongoOutbox } = require('../src/mongodb/index.js');

const URL = process.env.MONGODB_URL;
const JOBS = Number(process.argv[2] ?? 2000);

// A collection that counts the round trips made through it.
const counting = (collection) => {
  const counts = { total: 0 };
  return {
    counts,
    collection: new Proxy(collection, {
      get(target, property) {
        const value = target[property];
        if (typeof value !== 'function') return value;
        return (...args) => {
          counts.total += 1;
          counts[property] = (counts[property] ?? 0) + 1;
          return value.apply(target, args);
        };
      },
    }),
  };
};

const requestOf = (index) => ({
  id: randomUUID(),
  name: 'mail',
  data: { v: 1, n: index },
  hash: `h${index}`,
  priority: index % 10 === 0 ? 'high' : 'normal',
  maxAttempts: 5,
  enqueuedAt: Date.now(),
  unique: true,
});

const run = async (db, { workers, lanes, changeStream }) => {
  const raw = db.collection(`outbox_${randomUUID().replaceAll('-', '')}`);
  const { collection, counts } = counting(raw);
  const setup = createMongoOutbox({ collection: raw });
  await setup.ensureIndexes();
  for (let index = 0; index < JOBS; index++) await setup.source.enqueue(requestOf(index));
  let done = 0;
  let finished;
  const all = new Promise((resolve) => {
    finished = resolve;
  });
  const handler = async () => {
    done += 1;
    if (done === JOBS) finished();
    return { type: 'ack' };
  };
  counts.total = 0;
  const started = performance.now();
  const consumers = [];
  for (let worker = 0; worker < workers; worker++) {
    const outbox = createMongoOutbox({ collection, changeStream, pollIntervalMilliseconds: 50 });
    consumers.push(outbox.consume(handler, { concurrency: lanes }));
  }
  await all;
  const seconds = (performance.now() - started) / 1000;
  for (const consumer of consumers) await consumer.close({ timeoutMilliseconds: 1000 });
  await raw.drop();
  return { jobsPerSecond: Math.round(JOBS / seconds), roundTrips: counts.total / JOBS };
};

const main = async () => {
  if (URL === undefined || URL === '') {
    console.error('bench/outbox.js needs MONGODB_URL: a replica set, as for pnpm test:mongodb.');
    process.exit(1);
  }
  const client = new MongoClient(URL);
  await client.connect();
  const db = client.db(`mailer_bench_${randomUUID().replaceAll('-', '')}`);
  const rows = [];
  try {
    for (const changeStream of [false, true]) {
      for (const workers of [1, 4]) {
        for (const lanes of [1, 10]) {
          const result = await run(db, { workers, lanes, changeStream });
          rows.push({ workers, lanes, changeStream, ...result });
        }
      }
    }
  } finally {
    await db.dropDatabase();
    await client.close();
  }
  console.log(`${JOBS} jobs, acknowledged at once\n`);
  console.log('| workers | lanes | change stream | jobs/s | round trips a job |');
  console.log('| --- | --- | --- | --- | --- |');
  for (const row of rows) {
    console.log(
      `| ${row.workers} | ${row.lanes} | ${row.changeStream ? 'yes' : 'no'} | ` +
        `${row.jobsPerSecond} | ${row.roundTrips.toFixed(1)} |`,
    );
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
