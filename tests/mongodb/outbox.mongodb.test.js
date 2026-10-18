// Not ported: the stores of ./mongodb and the mail queue of ./queue on
// MongoDB itself (tests/mongodb/docker-compose.yml), skipped unless
// MONGODB_URL is set. Each test has a database of its own, dropped after.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { MongoClient } = require('mongodb');
const { IdempotencyTransport } = require('../../src/idempotency/index.js');
const { createMailQueue } = require('../../src/queue/index.js');
const {
  createMongoAuditSink,
  createMongoIdempotencyStore,
  createMongoOutbox,
} = require('../../src/mongodb/index.js');
const { fakeTransport } = require('../helpers/decorators/fake.js');

const url = process.env.MONGODB_URL;
const skip = url === undefined || url === '';

const until = async (check, timeout = 10_000) => {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const job = (extra = {}) => ({
  kind: 'content',
  from: 'app@example.com',
  to: 'ada@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
  idempotencyKey: randomUUID(),
  ...extra,
});

const setup = async (t, options = {}) => {
  const client = new MongoClient(url);
  await client.connect();
  const db = client.db(`mailer_test_${randomUUID().replaceAll('-', '')}`);
  const workers = [];
  // Before anything that may throw: a client left open holds the run.
  t.after(async () => {
    for (const worker of workers) await worker.close({ timeoutMilliseconds: 1000 });
    await db.dropDatabase();
    await client.close();
  });
  const outbox = createMongoOutbox({
    collection: db.collection('mail_outbox'),
    pollIntervalMilliseconds: 20,
    ...options,
  });
  const audit = createMongoAuditSink({ collection: db.collection('mail_audit') });
  const store = createMongoIdempotencyStore({ collection: db.collection('mail_idempotency') });
  await outbox.ensureIndexes();
  await audit.ensureIndexes();
  await store.ensureIndexes();
  const queue = createMailQueue({ driver: outbox, audit });
  const worker = (workerOptions) => {
    const consumer = queue.createWorker(workerOptions);
    workers.push(consumer);
    return consumer;
  };
  return { client, db, outbox, audit, store, queue, worker };
};

test(
  'MongoDB (replica set): a job is written in the transaction of its cause, or not at all',
  { skip },
  async (t) => {
    const { client, db, outbox, audit, queue, worker } = await setup(t);
    const users = db.collection('users');
    // Aborted: neither the user's write nor the job, nor its audit event.
    const aborted = client.startSession();
    let abortedId;
    await aborted
      .withTransaction(async () => {
        await users.insertOne({ _id: 'u1', resetToken: 't1' }, { session: aborted });
        abortedId = (await queue.enqueue(job(), { transaction: aborted })).id;
        throw new Error('roll back');
      })
      .catch((error) => assert.equal(error.message, 'roll back'));
    await aborted.endSession();
    assert.equal(await outbox.get(abortedId), undefined);
    assert.equal(await users.findOne({ _id: 'u1' }), null);
    // Committed, with the same message enqueued twice in it: one job, and
    // the duplicate does not abort the transaction.
    const session = client.startSession();
    const input = job();
    let enqueued;
    await session.withTransaction(async () => {
      await users.insertOne({ _id: 'u2', resetToken: 't2' }, { session });
      enqueued = await queue.enqueue(input, { transaction: session });
      const again = await queue.enqueue(input, { transaction: session });
      assert.equal(again.duplicate, true);
    });
    await session.endSession();
    assert.ok(await users.findOne({ _id: 'u2' }));
    const transport = fakeTransport();
    worker({ transport });
    await until(async () => (await outbox.get(enqueued.id))?.state === 'completed');
    assert.equal(transport.calls.length, 1);
    assert.equal(await audit.stateOf(enqueued.correlationId), 'accepted');
    assert.deepEqual(
      (await audit.eventsOf(enqueued.correlationId)).map((event) => event.state),
      ['queued', 'rendered', 'submitted', 'accepted'],
    );
    await assert.rejects(queue.enqueue({ ...input, to: 'other@example.com' }), {
      code: 'queue.key_reused',
    });
  },
);

test(
  'MongoDB (replica set): workers of several processes run each job once',
  { skip },
  async (t) => {
    const { outbox, queue, worker } = await setup(t);
    const transport = fakeTransport();
    const ids = [];
    for (let index = 0; index < 30; index++) {
      ids.push((await queue.enqueue(job({ subject: `m${index}` }))).id);
    }
    worker({ transport, concurrency: 3 });
    worker({ transport, concurrency: 3 });
    await until(async () => transport.calls.length >= 30);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const subjects = transport.calls.map((call) => call.message.subject);
    assert.equal(subjects.length, 30);
    assert.equal(new Set(subjects).size, 30);
    for (const id of ids) assert.equal((await outbox.get(id)).state, 'completed');
  },
);

test(
  'MongoDB (replica set): a job whose lease ran out goes to another worker, redelivered',
  { skip },
  async (t) => {
    // One process, one clock: no skew to wait out.
    const { outbox, queue } = await setup(t, {
      leaseMilliseconds: 100,
      clockSkewToleranceMilliseconds: 0,
    });
    const { id } = await queue.enqueue(job());
    const { lease } = await outbox.source.reserve(100);
    assert.equal(lease.job.id, id);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const again = await outbox.source.reserve(1000);
    assert.deepEqual(
      [again.lease.job.id, again.lease.job.attempt, again.lease.job.redelivered],
      [id, 1, true],
    );
    assert.equal(await outbox.source.extend(lease, 1000), false);
    await outbox.source.ack(lease);
    assert.equal((await outbox.get(id)).state, 'active');
    await outbox.source.ack(again.lease, { ok: 1 });
    assert.equal((await outbox.get(id)).state, 'completed');
  },
);

test(
  'MongoDB (replica set): of concurrent reserves of a key, one holds it',
  { skip },
  async (t) => {
    const { store } = await setup(t);
    const reservations = await Promise.all(
      Array.from({ length: 10 }, () => store.reserve('k', 'f', 10_000)),
    );
    const tokens = reservations.filter((reservation) => reservation.token !== undefined);
    assert.equal(tokens.length, 1);
    assert.equal(
      reservations.filter((reservation) => reservation.record?.state === 'pending').length,
      9,
    );
    // Behind it, a message is sent once however many workers send it.
    const inner = fakeTransport();
    const transport = new IdempotencyTransport(inner, { store });
    const { createMessage } = require('../../index.js');
    const message = createMessage({ ...job(), idempotencyKey: 'once' });
    await Promise.all([transport.send(message), transport.send(message), transport.send(message)]);
    assert.equal(inner.calls.length, 1);
  },
);

test('MongoDB (replica set): a change stream wakes the workers at once', { skip }, async (t) => {
  const { outbox, queue, worker } = await setup(t, {
    changeStream: true,
    pollIntervalMilliseconds: 10_000,
  });
  const transport = fakeTransport();
  worker({ transport });
  // The first reserve finds nothing; the next poll is ten seconds away.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const started = Date.now();
  const { id } = await queue.enqueue(job());
  await until(async () => (await outbox.get(id))?.state === 'completed', 5000);
  assert.ok(Date.now() - started < 3000, 'woken by the change stream');
});

const { sourceContract } = require('../helpers/queue/source-contract.js');

sourceContract(
  'mongodb, a replica set',
  async ({ now }) => {
    const client = new MongoClient(url);
    await client.connect();
    const db = client.db(`mailer_test_${randomUUID().replaceAll('-', '')}`);
    const outbox = createMongoOutbox({ collection: db.collection('mail_outbox'), now });
    await outbox.ensureIndexes();
    return {
      source: outbox.source,
      cleanup: async () => {
        await db.dropDatabase();
        await client.close();
      },
    };
  },
  { skip },
);

test(
  'MongoDB (replica set): when the next job is due is read from an index, not a sort',
  { skip },
  async (t) => {
    const { outbox, queue, db } = await setup(t);
    for (let index = 0; index < 50; index++) {
      await queue.enqueue(job({ scheduledAt: new Date(Date.now() + 60_000 + index) }));
    }
    assert.ok(outbox);
    const plan = await db
      .collection('mail_outbox')
      .find({ state: 'ready' })
      .sort({ availableAt: 1 })
      .project({ availableAt: 1 })
      .limit(1)
      .explain();
    const text = JSON.stringify(plan.queryPlanner.winningPlan);
    assert.match(text, /IXSCAN/);
    assert.doesNotMatch(text, /"stage":"SORT"/);
  },
);
