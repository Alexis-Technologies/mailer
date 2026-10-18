// Not ported: tests of ./mongodb against a collection in memory
// (tests/helpers/mongodb); tests/mongodb runs them on MongoDB itself.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMemoryAuditSink } = require('../../src/audit/index.js');
const { IdempotencyTransport } = require('../../src/idempotency/index.js');
const { createMailQueue } = require('../../src/queue/index.js');
const {
  createMongoAuditSink,
  createMongoIdempotencyStore,
  createMongoOutbox,
} = require('../../src/mongodb/index.js');
const { fakeCollection } = require('../helpers/mongodb/fake-collection.js');
const { fakeTransport, sent } = require('../helpers/decorators/fake.js');

const requestOf = (id, extra = {}) => ({
  id,
  name: 'mail',
  data: { n: id },
  hash: `h-${id}`,
  priority: 'normal',
  maxAttempts: 3,
  enqueuedAt: 1000,
  unique: true,
  ...extra,
});

const outboxOf = (options = {}) => {
  let time = options.start ?? 10_000;
  const collection = options.collection ?? fakeCollection();
  const outbox = createMongoOutbox({ collection, now: () => time, ...options.extra });
  return {
    collection,
    outbox,
    source: outbox.source,
    now: () => time,
    advance: (ms) => {
      time += ms;
    },
  };
};

test('MongoDB: a job is written once under its id, in the transaction it is given', async () => {
  const { collection, source } = outboxOf();
  const session = { id: 'session-1' };
  assert.deepStrictEqual(await source.enqueue(requestOf('a'), { transaction: session }), {
    id: 'a',
    duplicate: false,
  });
  // An upsert, not an insert, so that a duplicate does not abort the transaction.
  const [, filter, update, options] = collection.calls[0];
  assert.deepStrictEqual([filter, options], [{ _id: 'a' }, { session, upsert: true }]);
  assert.strictEqual(update.$setOnInsert.state, 'ready');
  assert.strictEqual(update.$setOnInsert.rank, 1);
  assert.deepStrictEqual(
    await source.enqueue(requestOf('a', { hash: 'other' }), { transaction: session }),
    {
      id: 'a',
      duplicate: true,
      existingHash: 'h-a',
    },
  );
  assert.strictEqual(collection.calls[2][2].session, session);
  const stored = collection.documents.get('a');
  assert.ok(stored.availableAt instanceof Date && stored.enqueuedAt instanceof Date);
  // A held job without a hash, and the requests it refuses.
  collection.documents.get('a').hash = undefined;
  assert.deepStrictEqual(await source.enqueue(requestOf('a')), { id: 'a', duplicate: true });
  for (const bad of [
    {},
    requestOf('x:y'),
    requestOf('p', { priority: 'urgent' }),
    requestOf('m', { maxAttempts: 0 }),
  ]) {
    await assert.rejects(source.enqueue(bad), /takes a job request/);
  }
});

test('MongoDB: jobs are lent by priority, then time, their attempts counted', async () => {
  const { source, advance } = outboxOf();
  await source.enqueue(requestOf('low', { priority: 'low', enqueuedAt: 1 }));
  await source.enqueue(requestOf('n2', { enqueuedAt: 3 }));
  await source.enqueue(requestOf('n1', { enqueuedAt: 2 }));
  await source.enqueue(requestOf('high', { priority: 'high', enqueuedAt: 4 }));
  await source.enqueue(requestOf('later', { availableAt: 60_000 }));
  const order = [];
  for (;;) {
    const { lease, nextAvailableAt } = await source.reserve(1000);
    if (lease === undefined) {
      assert.strictEqual(nextAvailableAt, 60_000);
      break;
    }
    order.push([lease.job.id, lease.job.attempt, lease.job.redelivered]);
    await source.ack(lease, { ok: true });
  }
  assert.deepStrictEqual(order, [
    ['high', 1, false],
    ['n1', 1, false],
    ['n2', 1, false],
    ['low', 1, false],
  ]);
  advance(60_000);
  const { lease } = await source.reserve(1000);
  assert.strictEqual(lease.job.id, 'later');
  assert.deepStrictEqual(Object.keys(lease.job), [
    'id',
    'name',
    'data',
    'attempt',
    'maxAttempts',
    'enqueuedAt',
    'redelivered',
    'redeliveries',
  ]);
  await source.ack(lease);
  assert.deepStrictEqual(await source.reserve(1000), {});
});

test('MongoDB: a lease that runs out gives the job to another, the late settle ignored', async () => {
  const { source, outbox, advance, now } = outboxOf();
  await source.enqueue(requestOf('a'));
  const first = (await source.reserve(1000)).lease;
  assert.strictEqual(await source.extend(first, 1000), true);
  // Past its end by more than the skew of the clocks (5 s).
  advance(6001);
  const second = (await source.reserve(1000)).lease;
  assert.deepStrictEqual([second.job.attempt, second.job.redelivered], [1, true]);
  // The first holder's writes do nothing now.
  assert.strictEqual(await source.extend(first, 1000), false);
  await source.ack(first, { from: 'first' });
  await source.fail(first, { code: 'x', reason: 'late' });
  assert.strictEqual((await outbox.get('a')).state, 'active');
  await source.retry(second, now() + 10_000, { code: 'http.503', reason: 'busy' });
  const retried = await outbox.get('a');
  assert.deepStrictEqual(
    [retried.state, retried.failure.code, retried.attempt],
    ['ready', 'http.503', 1],
  );
  advance(10_000);
  const third = (await source.reserve(1000)).lease;
  assert.deepStrictEqual([third.job.attempt, third.job.redelivered], [2, false]);
  // A release gives it back without spending the attempt.
  await source.release(third);
  const fourth = (await source.reserve(1000)).lease;
  assert.strictEqual(fourth.job.attempt, 2);
  const later = now() + 5000;
  await source.release(fourth, later);
  assert.deepStrictEqual(await source.reserve(1000), { nextAvailableAt: later });
  advance(5000);
  const fifth = (await source.reserve(1000)).lease;
  await source.fail(fifth, { code: 'x.rejected', reason: 'no such user' });
  const failed = await outbox.get('a');
  assert.deepStrictEqual([failed.state, failed.failure.code], ['failed', 'x.rejected']);
  assert.strictEqual(await outbox.get('missing'), undefined);
});

test('MongoDB: a pause of the queue holds every worker until it ends', async () => {
  const { source, outbox, advance } = outboxOf();
  await source.enqueue(requestOf('a'));
  await source.pause(15_000);
  await source.pause(12_000);
  assert.deepStrictEqual(await source.reserve(1000), { nextAvailableAt: 15_000 });
  assert.strictEqual(await outbox.get('mailer:pause'), undefined);
  advance(5000);
  assert.strictEqual((await source.reserve(1000)).lease.job.id, 'a');
});

test('MongoDB: an older driver’s findOneAndUpdate, which gives { value }, is read too', async () => {
  const { source } = outboxOf({ collection: fakeCollection({ modifyResult: true }) });
  await source.enqueue(requestOf('a'));
  assert.strictEqual((await source.reserve(1000)).lease.job.id, 'a');
  assert.deepStrictEqual(await source.reserve(1000), {});
});

test('MongoDB: the outbox makes its indexes, and wakes its workers on a change stream', async () => {
  const records = [];
  const { collection, outbox } = outboxOf({
    extra: {
      changeStream: true,
      logger: { warn: (record, message) => records.push([message, record.error]) },
    },
  });
  await outbox.ensureIndexes();
  assert.deepStrictEqual(collection.indexes, [
    [{ state: 1, rank: 1, availableAt: 1, enqueuedAt: 1 }, { name: 'mailer_ready' }],
    [{ state: 1, leaseUntil: 1 }, { name: 'mailer_leases' }],
    [{ state: 1, availableAt: 1 }, { name: 'mailer_due' }],
    [{ state: 1, tenantId: 1, rank: 1, availableAt: 1, enqueuedAt: 1 }, { name: 'mailer_tenant' }],
    [{ expireAt: 1 }, { name: 'mailer_expire', expireAfterSeconds: 0 }],
  ]);
  let woken = 0;
  const unsubscribe = outbox.source.subscribe(() => woken++);
  const [stream] = collection.streams;
  // Only a change after which a job may be ready wakes a worker.
  assert.deepStrictEqual(stream.pipeline, [
    {
      $match: {
        $or: [
          { operationType: 'insert', 'fullDocument.state': 'ready' },
          { operationType: 'update', 'updateDescription.updatedFields.state': 'ready' },
          { operationType: 'replace', 'fullDocument.state': 'ready' },
        ],
      },
    },
  ]);
  await outbox.source.enqueue(requestOf('a'));
  assert.strictEqual(woken, 1);
  stream.listeners.get('error')(new Error('not a replica set'));
  assert.deepStrictEqual(records, [['queue.change_stream_failed', 'not a replica set']]);
  unsubscribe();
  await new Promise(setImmediate);
  assert.strictEqual(collection.streams.length, 0);
  // A close that fails goes unheard.
  const failing = outboxOf({
    collection: fakeCollection({ failOn: { close: new Error('closed') } }),
    extra: { changeStream: true },
  });
  failing.outbox.source.subscribe(() => {})();
  await new Promise(setImmediate);
});

test('MongoDB: the outbox checks its options', () => {
  assert.throws(
    () => createMongoOutbox(),
    /needs a collection of the MongoDB driver, with updateOne/,
  );
  assert.throws(() => createMongoOutbox({ collection: { updateOne() {} } }), /with updateMany/);
  const collection = fakeCollection();
  assert.throws(
    () => createMongoOutbox({ collection, changeStream: 'yes' }),
    /changeStream must be a boolean/,
  );
  assert.throws(
    () =>
      createMongoOutbox({ collection: { ...collection, watch: undefined }, changeStream: true }),
    /changeStream needs a collection with watch/,
  );
  assert.throws(
    () => createMongoOutbox({ collection, dedupeWindowSeconds: 0 }),
    /dedupeWindowSeconds/,
  );
  assert.throws(
    () => createMongoOutbox({ collection, retainFailedSeconds: 1.5 }),
    /retainFailedSeconds/,
  );
  assert.throws(() => createMongoOutbox({ collection, now: 1 }), /now/);
  // Without a change stream, there is nothing to subscribe to.
  assert.strictEqual(createMongoOutbox({ collection }).source.subscribe, undefined);
});

test('MongoDB: the mail queue runs on the outbox, its audit in MongoDB', async () => {
  const collection = fakeCollection();
  const auditCollection = fakeCollection();
  const outbox = createMongoOutbox({ collection, pollIntervalMilliseconds: 5 });
  const audit = createMongoAuditSink({ collection: auditCollection });
  const queue = createMailQueue({ driver: outbox, audit });
  const session = { id: 's' };
  const { id, correlationId } = await queue.enqueue(
    {
      kind: 'content',
      from: 'app@example.com',
      to: 'ada@example.com',
      subject: 'Hi',
      content: { text: 'Hello' },
      idempotencyKey: 'welcome:1',
    },
    { transaction: session },
  );
  // The queued event goes in the transaction of the enqueue.
  assert.strictEqual(auditCollection.calls[0][3].session, session);
  const transport = fakeTransport(() => sent('p-1'));
  const worker = queue.createWorker({ transport });
  for (let index = 0; index < 100 && (await outbox.get(id)).state !== 'completed'; index++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await worker.close();
  assert.strictEqual((await outbox.get(id)).state, 'completed');
  assert.deepStrictEqual((await outbox.get(id)).result, {
    provider: 'fake',
    providerMessageId: 'p-1',
  });
  assert.strictEqual(await audit.stateOf(correlationId), 'accepted');
  assert.deepStrictEqual(
    (await audit.eventsOf(correlationId)).map((event) => event.state),
    ['queued', 'rendered', 'submitted', 'accepted'],
  );
});

test('MongoDB: the audit sink writes an event once by its id', async () => {
  const collection = fakeCollection();
  const sink = createMongoAuditSink({ collection });
  const event = {
    id: 'e1',
    state: 'queued',
    at: '2026-10-18T09:00:00.000Z',
    source: 'producer',
    correlationId: 'c1',
    attempt: 0,
  };
  // Two events of one time and attempt read in the order of their states.
  await sink.append({ ...event, id: 'e0', state: 'submitted', attempt: 1 });
  await sink.append({ ...event, id: 'e00', state: 'rendered', attempt: 1 });
  assert.deepStrictEqual(
    (await sink.eventsOf('c1')).map((e) => e.state),
    ['rendered', 'submitted'],
  );
  collection.documents.clear();
  await sink.append(event);
  await sink.append({ ...event, state: 'failed' });
  await sink.append({ ...event, id: 'e2', state: 'accepted', at: '2026-10-18T09:00:01.000Z' });
  const stored = collection.documents.get('e1');
  assert.deepStrictEqual(
    [stored.state, stored.at instanceof Date, stored.rank],
    ['queued', true, 0],
  );
  assert.deepStrictEqual(await sink.eventsOf('c1'), [
    event,
    { ...event, id: 'e2', state: 'accepted', at: '2026-10-18T09:00:01.000Z' },
  ]);
  assert.strictEqual(await sink.stateOf('c1'), 'accepted');
  assert.strictEqual(await sink.stateOf('none'), undefined);
  await assert.rejects(sink.append({}), /has an id/);
  await sink.ensureIndexes();
  assert.deepStrictEqual(collection.indexes, [
    [{ correlationId: 1, at: 1, attempt: 1, rank: 1 }, { name: 'mailer_correlation' }],
    [{ jobId: 1 }, { name: 'mailer_job', sparse: true }],
    [{ providerMessageId: 1 }, { name: 'mailer_provider_message', sparse: true }],
  ]);
  // A sink keeps the memory sink's contract.
  const memory = createMemoryAuditSink();
  memory.append(event);
  assert.deepStrictEqual(memory.events[0], (await sink.eventsOf('c1'))[0]);
  assert.throws(() => createMongoAuditSink(), /createMongoAuditSink needs a collection/);
});

test('MongoDB: a key is reserved once, by one atomic step, and fenced by its token', async () => {
  let time = 1000;
  const collection = fakeCollection();
  const store = createMongoIdempotencyStore({ collection, now: () => time });
  const { token } = await store.reserve('k', 'f1', 100);
  assert.match(token, /^[0-9a-f-]{36}$/);
  assert.deepStrictEqual(await store.reserve('k', 'f1', 100), {
    record: { state: 'pending', fingerprint: 'f1' },
  });
  // A lease that ran out frees the key for another.
  time += 101;
  const second = await store.reserve('k', 'f1', 100);
  assert.notStrictEqual(second.token, token);
  // The first holder can neither release nor complete it now.
  await store.release('k', token);
  await store.complete(
    'k',
    token,
    { fingerprint: 'f1', receipt: { successful: true, messageId: 'late' } },
    1000,
  );
  assert.strictEqual(collection.documents.get('k').token, second.token);
  await store.complete(
    'k',
    second.token,
    { fingerprint: 'f1', receipt: { successful: true, messageId: 'm1' } },
    1000,
  );
  assert.deepStrictEqual(await store.reserve('k', 'f1', 100), {
    record: { state: 'done', fingerprint: 'f1', receipt: { successful: true, messageId: 'm1' } },
  });
  // A failed send frees its key.
  const third = await store.reserve('free', 'f', 100);
  await store.release('free', third.token);
  assert.strictEqual(collection.documents.has('free'), false);
  // A key not held is completed as given.
  await store.complete(
    'new',
    'tok',
    { fingerprint: 'f', receipt: { successful: true, messageId: 'x' } },
    50,
  );
  assert.strictEqual(collection.documents.get('new').state, 'done');
  await store.ensureIndexes();
  assert.deepStrictEqual(collection.indexes, [
    [{ expiresAt: 1 }, { name: 'mailer_expires', expireAfterSeconds: 0 }],
  ]);
});

test('MongoDB: the store surfaces what is not a duplicate key, and reads a key dropped meanwhile again', async () => {
  const outage = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
  const broken = createMongoIdempotencyStore({
    collection: fakeCollection({ failOn: { updateOne: outage } }),
  });
  await assert.rejects(broken.reserve('k', 'f', 10), /connection reset/);
  await assert.rejects(
    broken.complete('k', 't', { fingerprint: 'f', receipt: {} }, 10),
    /connection reset/,
  );
  // A key held at the upsert and gone at the read: tried again, then refused.
  const collection = fakeCollection();
  const store = createMongoIdempotencyStore({ collection });
  collection.updateOne = async () => {
    throw Object.assign(new Error('E11000'), { code: 11000 });
  };
  collection.findOne = async () => null;
  await assert.rejects(store.reserve('k', 'f', 10), /could not be reserved in 3 tries/);
  assert.throws(() => createMongoIdempotencyStore(), /needs a collection/);
  assert.throws(() => createMongoIdempotencyStore({ collection: fakeCollection(), now: 1 }), /now/);
});

test('MongoDB: IdempotencyTransport sends a key once over the shared store', async () => {
  const store = createMongoIdempotencyStore({ collection: fakeCollection() });
  const inner = fakeTransport();
  const transport = new IdempotencyTransport(inner, { store });
  const { createMessage } = require('../../index.js');
  const message = createMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 's',
    content: { text: 't' },
    idempotencyKey: 'once',
  });
  const first = await transport.send(message);
  const again = await transport.send(message);
  assert.strictEqual(inner.calls.length, 1);
  assert.strictEqual(again.messageId, first.messageId);
});

test('MongoDB: a lease is taken back only past the skew of the workers’ clocks', async () => {
  const { source, advance } = outboxOf({ extra: { clockSkewToleranceMilliseconds: 2000 } });
  await source.enqueue(requestOf('a'));
  await source.reserve(1000);
  // Run out by this clock, but a worker whose clock is 2 s behind still holds it.
  advance(2500);
  assert.deepStrictEqual(await source.reserve(1000), {});
  advance(501);
  assert.strictEqual((await source.reserve(1000)).lease.job.redelivered, true);
  const strict = outboxOf({ extra: { clockSkewToleranceMilliseconds: 0 } });
  await strict.source.enqueue(requestOf('b'));
  await strict.source.reserve(1000);
  strict.advance(1000);
  assert.strictEqual((await strict.source.reserve(1000)).lease.job.id, 'b');
  assert.throws(
    () => outboxOf({ extra: { clockSkewToleranceMilliseconds: -1 } }),
    /clockSkewToleranceMilliseconds must be a whole number/,
  );
  assert.throws(
    () => outboxOf({ extra: { leaseMilliseconds: 15_000 } }),
    /more than 3 times clockSkewToleranceMilliseconds/,
  );
});

test('MongoDB: a job done with keeps no data, unless told; its duplicates are still told', async () => {
  const cases = [
    [undefined, [false, true]],
    ['all', [true, true]],
    ['none', [false, false]],
  ];
  for (const [retainData, [completedKeeps, failedKeeps]] of cases) {
    const { collection, source, outbox } = outboxOf({ extra: { retainData } });
    await source.enqueue(requestOf('done'));
    await source.enqueue(requestOf('refused'));
    for (let index = 0; index < 2; index++) {
      const { lease } = await source.reserve(1000);
      if (lease.job.id === 'done') await source.ack(lease, { provider: 'p' });
      else await source.fail(lease, { code: 'x', reason: 'y' });
    }
    assert.strictEqual('data' in collection.documents.get('done'), completedKeeps);
    assert.strictEqual('data' in collection.documents.get('refused'), failedKeeps);
    assert.strictEqual((await outbox.get('done')).data !== undefined, completedKeeps);
    const again = await source.enqueue(requestOf('done'));
    assert.deepStrictEqual([again.duplicate, typeof again.existingHash], [true, 'string']);
  }
  assert.throws(() => outboxOf({ extra: { retainData: 1 } }), /retainData must be/);
});

test('MongoDB: a completed job goes after the window of duplicates, a failed one later', async () => {
  const { collection, source, now } = outboxOf({
    extra: { dedupeWindowSeconds: 3600, retainFailedSeconds: 7200 },
  });
  await source.enqueue(requestOf('done'));
  await source.enqueue(requestOf('refused'));
  for (let index = 0; index < 2; index++) {
    const { lease } = await source.reserve(1000);
    if (lease.job.id === 'done') await source.ack(lease, null);
    else await source.fail(lease, { code: 'x', reason: 'y' });
  }
  assert.strictEqual(collection.documents.get('done').expireAt.getTime(), now() + 3_600_000);
  assert.strictEqual(collection.documents.get('refused').expireAt.getTime(), now() + 7_200_000);
  // By default, a day and a week, whatever the driver.
  const defaults = outboxOf();
  await defaults.source.enqueue(requestOf('a'));
  await defaults.source.ack((await defaults.source.reserve(1000)).lease, null);
  assert.strictEqual(
    defaults.collection.documents.get('a').expireAt.getTime(),
    defaults.now() + 86_400_000,
  );
});

test('MongoDB: the audit sink tells whether it holds an event', async () => {
  const collection = fakeCollection();
  const sink = createMongoAuditSink({ collection });
  await sink.append({
    id: 'e1',
    state: 'submitted',
    at: '2026-10-18T09:00:00.000Z',
    source: 'worker',
    correlationId: 'c1',
    attempt: 1,
  });
  assert.deepStrictEqual([await sink.has('e1'), await sink.has('e2')], [true, false]);
  assert.deepStrictEqual(collection.calls.at(-1), [
    'findOne',
    { _id: 'e2' },
    { projection: { _id: 1 } },
  ]);
});

test('MongoDB: a reserve takes back leases once a third of a lease, and reads the pause once a poll', async () => {
  const { collection, source, advance } = outboxOf({ extra: { pollIntervalMilliseconds: 1000 } });
  const count = (name) => collection.calls.filter((call) => call[0] === name).length;
  for (let index = 0; index < 5; index++) await source.reserve(60_000);
  // Idle, five reserves of five lanes: one write to take back leases, one read of the pause.
  assert.strictEqual(count('updateMany'), 1);
  assert.strictEqual(count('find'), 1);
  advance(20_000);
  await source.reserve(60_000);
  assert.strictEqual(count('updateMany'), 2);
  // A pause of another process is seen within a poll interval.
  const other = createMongoOutbox({ collection, now: () => 0 });
  await source.enqueue(requestOf('a'));
  await other.source.pause(90_000_000);
  assert.strictEqual((await source.reserve(60_000)).lease?.job.id, 'a');
  advance(1000);
  await source.enqueue(requestOf('b'));
  assert.deepStrictEqual(await source.reserve(60_000), {
    nextAvailableAt: 90_000_000,
  });
});

test('MongoDB: a change stream that fails is opened again, later each time', async () => {
  const { manualClock } = require('../helpers/queue/clock.js');
  const clock = manualClock(0);
  const records = [];
  const collection = fakeCollection();
  const outbox = createMongoOutbox({
    collection,
    changeStream: true,
    now: clock.now,
    sleep: clock.sleep,
    logger: { warn: (record) => records.push(record.failures) },
  });
  let woken = 0;
  const unsubscribe = outbox.source.subscribe(() => woken++);
  const settle = () => new Promise(setImmediate);
  collection.streams[0].listeners.get('error')(new Error('failover'));
  await settle();
  assert.strictEqual(collection.streams.length, 0);
  clock.advance(1000);
  await settle();
  assert.strictEqual(collection.streams.length, 1);
  collection.streams[0].listeners.get('error')(new Error('again'));
  await settle();
  clock.advance(1000);
  await settle();
  // The second wait is longer.
  assert.strictEqual(collection.streams.length, 0);
  clock.advance(1000);
  await settle();
  assert.strictEqual(collection.streams.length, 1);
  assert.deepStrictEqual(records, [0, 1]);
  // A change resets the wait, and wakes a worker.
  collection.streams[0].listeners.get('change')({ operationType: 'insert' });
  assert.strictEqual(woken, 1);
  collection.streams[0].listeners.get('error')(new Error('once more'));
  unsubscribe();
  clock.advance(60_000);
  await settle();
  assert.strictEqual(collection.streams.length, 0);
});

test('MongoDB: the audit sink writes a batch in one bulkWrite, each event once', async () => {
  const collection = fakeCollection();
  const sink = createMongoAuditSink({ collection });
  const event = (id) => ({
    id,
    state: 'queued',
    at: '2026-10-18T09:00:00.000Z',
    source: 'producer',
    correlationId: id,
    attempt: 0,
  });
  await sink.appendMany([event('e1'), event('e2')], { transaction: 'session' });
  await sink.appendMany([event('e1'), event('e3')]);
  await sink.appendMany([]);
  assert.deepStrictEqual(
    collection.calls.filter((call) => call[0] === 'bulkWrite'),
    [
      ['bulkWrite', 2, { session: 'session', ordered: false }],
      ['bulkWrite', 2, { ordered: false }],
    ],
  );
  assert.strictEqual(collection.documents.size, 3);
  // A collection without bulkWrite is written one event at a time.
  const plain = fakeCollection();
  plain.bulkWrite = undefined;
  await createMongoAuditSink({ collection: plain }).appendMany([event('e1'), event('e2')]);
  assert.strictEqual(plain.documents.size, 2);
});

test('MongoDB: the outbox tells what it holds, lists its failed jobs and retries one', async () => {
  const { source, outbox, advance } = outboxOf({ start: 10_000 });
  await source.enqueue(requestOf('r1', { enqueuedAt: 4000 }));
  await source.enqueue(requestOf('later', { availableAt: 99_999 }));
  for (const id of ['f2', 'f1', 'f3']) {
    await source.enqueue(requestOf(id, { enqueuedAt: 9000, priority: 'high' }));
  }
  for (let index = 0; index < 3; index++) {
    await source.fail((await source.reserve(1000)).lease, { code: 'x.rejected', reason: 'no' });
  }
  await source.pause(20_000, { tenantId: 'acme' });
  const stats = await outbox.stats();
  assert.deepStrictEqual(
    [stats.ready, stats.delayed, stats.active, stats.completed, stats.failed],
    [1, 1, 0, 0, 3],
  );
  assert.strictEqual(stats.oldestReadyMilliseconds, 6000);
  assert.deepStrictEqual(stats.pausedTenants, [{ tenantId: 'acme', until: 20_000 }]);
  await outbox.resume({ tenantId: 'acme' });
  assert.strictEqual((await outbox.stats()).pausedTenants, undefined);
  assert.deepStrictEqual(
    (await outbox.failed({ limit: 2 })).map((job) => job.id),
    ['f1', 'f2'],
  );
  assert.deepStrictEqual(
    (await outbox.failed({ after: 'f2' })).map((job) => job.id),
    ['f3'],
  );
  assert.strictEqual(await outbox.retryFailed('f1'), true);
  assert.strictEqual(await outbox.retryFailed('f1'), false);
  const again = await outbox.get('f1');
  assert.deepStrictEqual([again.state, again.attempt, again.failure], ['ready', 0, undefined]);
  advance(1);
  assert.strictEqual((await source.reserve(1000)).lease.job.id, 'f1');
  const none = outboxOf({ extra: { retainData: 'none' } });
  await none.source.enqueue(requestOf('x'));
  await none.source.fail((await none.source.reserve(1000)).lease, { code: 'x', reason: 'y' });
  await assert.rejects(none.outbox.retryFailed('x'), /keeps no data/);
});

test('MongoDB: the events of a message are found by the provider’s id of it', async () => {
  const { auditEventOfDeliveryEvent } = require('../../src/audit/index.js');
  const collection = fakeCollection();
  const sink = createMongoAuditSink({ collection });
  const base = { source: 'worker', correlationId: 'order-42', attempt: 1 };
  await sink.append({ ...base, id: 'e1', state: 'submitted', at: '2026-10-18T09:00:00.000Z' });
  await sink.append({
    ...base,
    id: 'e2',
    state: 'accepted',
    at: '2026-10-18T09:00:01.000Z',
    providerMessageId: 'ses-1',
  });
  // A webhook's event with no correlationId is filed under the provider's id.
  const delivered = auditEventOfDeliveryEvent({
    id: 'w1',
    provider: 'ses',
    type: 'delivered',
    messageId: 'ses-1',
    occurredAt: new Date('2026-10-18T09:00:05.000Z'),
  });
  assert.strictEqual(delivered.correlationId, 'ses-1');
  await sink.append(delivered);
  const events = await sink.eventsOfProviderMessage('ses-1');
  assert.deepStrictEqual(
    events.map((event) => event.state),
    ['submitted', 'accepted', 'delivered'],
  );
  assert.deepStrictEqual(await sink.eventsOfProviderMessage('unknown'), []);
});
