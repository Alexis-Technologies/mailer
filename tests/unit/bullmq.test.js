// Not ported: tests of the BullMQ driver of ./bullmq against stand-ins of
// its classes; tests/bullmq runs it on BullMQ and Valkey.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  MAILER_BACKOFF_TYPE,
  createBullMQBackoffStrategy,
  createBullMQDriver,
  createBullMQProcessor,
} = require('../../src/bullmq/index.js');
const { fakeBullMQ, fakeJob } = require('../helpers/bullmq/fake-bullmq.js');

const requestOf = (extra = {}) => ({
  id: 'job-1',
  name: 'mail',
  data: { hash: 'h1', v: 1 },
  hash: 'h1',
  priority: 'normal',
  maxAttempts: 5,
  enqueuedAt: 1000,
  unique: true,
  ...extra,
});

const failureOf = (promise) =>
  promise.then(
    () => assert.fail('expected a failure'),
    (error) => error,
  );

test('BullMQ: a job is added under its id with the queue’s attempts, backoff and priority', async () => {
  const bullmq = fakeBullMQ();
  const driver = createBullMQDriver({
    bullmq,
    connection: { host: 'valkey' },
    prefix: 'app',
    jobOptions: { removeOnComplete: { age: 60 }, sizeLimit: 1024 },
  });
  const [queue] = bullmq.queues;
  assert.deepStrictEqual(
    [queue.name, queue.opts],
    ['mail', { connection: { host: 'valkey' }, prefix: 'app' }],
  );
  assert.deepStrictEqual(await driver.enqueue(requestOf({ priority: 'high' })), {
    id: 'job-1',
    duplicate: false,
  });
  assert.deepStrictEqual(queue.added[0], {
    name: 'mail',
    data: { hash: 'h1', v: 1 },
    opts: {
      removeOnComplete: { age: 60 },
      removeOnFail: { age: 604_800 },
      sizeLimit: 1024,
      jobId: 'job-1',
      timestamp: 1000,
      priority: 1,
      delay: 0,
      attempts: 5,
      backoff: { type: MAILER_BACKOFF_TYPE },
    },
  });
  // A job not before its time is delayed; priorities are never 0.
  await driver.enqueue(
    requestOf({ id: 'later', availableAt: Date.now() + 60_000, priority: 'low' }),
  );
  const later = queue.added[1].opts;
  assert.ok(later.delay > 59_000 && later.delay <= 60_000);
  assert.strictEqual(later.priority, 3);
  await driver.enqueue(requestOf({ id: 'past', availableAt: 0 }));
  assert.deepStrictEqual([queue.added[2].opts.delay, queue.added[2].opts.priority], [0, 2]);
  await driver.close();
  assert.strictEqual(queue.closed, 1);
  assert.strictEqual(driver.id, 'bullmq');
  assert.strictEqual(driver.queue, queue);
});

test('BullMQ: a job added again under its id is told as a duplicate, with its hash', async () => {
  const bullmq = fakeBullMQ();
  const driver = createBullMQDriver({ bullmq });
  await driver.enqueue(requestOf());
  assert.deepStrictEqual(await driver.enqueue(requestOf({ enqueuedAt: 2000, hash: 'h2' })), {
    id: 'job-1',
    duplicate: true,
    existingHash: 'h1',
  });
  // A job whose id is drawn at random is not looked up.
  const queue = bullmq.queues[0];
  queue.getJob = async () => assert.fail('not looked up');
  assert.deepStrictEqual(await driver.enqueue(requestOf({ id: 'r', unique: false })), {
    id: 'r',
    duplicate: false,
  });
  const blind = createBullMQDriver({ bullmq: fakeBullMQ(), detectDuplicates: false });
  assert.deepStrictEqual(await blind.enqueue(requestOf()), { id: 'job-1', duplicate: undefined });
  // Held without a hash; removed meanwhile.
  const other = fakeBullMQ();
  const plain = createBullMQDriver({ bullmq: other });
  await plain.enqueue(requestOf({ data: {} }));
  assert.deepStrictEqual(await plain.enqueue(requestOf({ enqueuedAt: 5 })), {
    id: 'job-1',
    duplicate: true,
  });
  other.queues[0].getJob = async () => undefined;
  assert.deepStrictEqual(await plain.enqueue(requestOf({ id: 'gone' })), {
    id: 'gone',
    duplicate: false,
  });
});

test('BullMQ: jobs are added in bulk, their duplicates told only when asked', async () => {
  const bullmq = fakeBullMQ();
  const driver = createBullMQDriver({ bullmq });
  const results = await driver.enqueueMany([requestOf(), requestOf({ id: 'r', unique: false })]);
  assert.deepStrictEqual(results, [
    { id: 'job-1', duplicate: undefined },
    { id: 'r', duplicate: false },
  ]);
  assert.strictEqual(bullmq.queues[0].added.length, 2);
  const bulk = createBullMQDriver({ bullmq: fakeBullMQ(), detectDuplicates: 'bulk' });
  await bulk.enqueue(requestOf());
  assert.deepStrictEqual(await bulk.enqueueMany([requestOf({ enqueuedAt: 9 })]), [
    { id: 'job-1', duplicate: true, existingHash: 'h1' },
  ]);
});

test('BullMQ: a queue of your own is used as it is, and not closed', async () => {
  const bullmq = fakeBullMQ();
  const own = new bullmq.Queue('emails', {});
  const driver = createBullMQDriver({ bullmq: { Queue: own, Worker: bullmq.Worker } });
  await driver.enqueue(requestOf());
  assert.strictEqual(own.added.length, 1);
  const consumer = driver.consume(async () => ({ type: 'ack' }));
  assert.strictEqual(consumer.worker.name, 'emails');
  await consumer.close();
  await driver.close();
  assert.strictEqual(own.closed, 0);
  // Without Worker, a driver only enqueues.
  const producer = createBullMQDriver({ bullmq: { Queue: own } });
  assert.throws(() => producer.consume(async () => ({ type: 'ack' })), /bullmq\.Worker/);
});

test('BullMQ: a worker runs the processor with the strategy of the queue, its events logged', async () => {
  const bullmq = fakeBullMQ();
  const records = [];
  const logger = {};
  for (const level of ['warn', 'error']) {
    logger[level] = (record, message) => records.push([level, message, record]);
  }
  const fallback = () => 7;
  const driver = createBullMQDriver({
    bullmq,
    connection: { host: 'valkey' },
    prefix: 'app',
    workerOptions: { lockDuration: 60_000, settings: { backoffStrategy: fallback, other: 1 } },
    logger,
  });
  const consumer = driver.consume(async () => ({ type: 'fail', code: 'x', reason: 'y' }), {
    concurrency: 4,
  });
  const worker = consumer.worker;
  assert.strictEqual(worker.processor.length, 3, 'three parameters, for BullMQ to pass its signal');
  assert.deepStrictEqual(
    {
      ...worker.opts,
      settings: {
        ...worker.opts.settings,
        backoffStrategy: typeof worker.opts.settings.backoffStrategy,
      },
    },
    {
      lockDuration: 60_000,
      connection: { host: 'valkey' },
      prefix: 'app',
      concurrency: 4,
      settings: { other: 1, backoffStrategy: 'function' },
    },
  );
  assert.strictEqual(worker.opts.settings.backoffStrategy(1, 'custom'), 7);
  // A failure the processor threw is its own; one BullMQ made is a lost job.
  const thrown = await failureOf(worker.processor(fakeJob(), 'token'));
  worker.emit('failed', { id: 'j1' }, thrown);
  worker.emit('failed', { id: 'j2' }, new Error('job stalled more than allowable limit'));
  worker.emit('stalled', 'j3');
  worker.emit('error', new Error('connection lost'));
  assert.deepStrictEqual(
    records.map(([level, message]) => `${level} ${message}`),
    ['error queue.job.lost', 'warn queue.job.stalled', 'error queue.worker.error'],
  );
  assert.strictEqual(records[0][2].jobId, 'j2');
  await consumer.close();
  assert.strictEqual(worker.closed, 1);
});

test('BullMQ: closing past its timeout tells the jobs to stop, then leaves them', async () => {
  const bullmq = fakeBullMQ();
  const records = [];
  const driver = createBullMQDriver({
    bullmq,
    logger: { warn: (record, message) => records.push(message) },
  });
  let seen;
  const consumer = driver.consume(async (job, signal) => {
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    seen = signal.reason;
    return { type: 'release' };
  });
  consumer.worker.closeWith = new Promise(() => {});
  const running = consumer.worker.processor(fakeJob(), 'token').catch((error) => error);
  await consumer.close({ timeoutMilliseconds: 5 });
  assert.strictEqual(seen?.name, 'AbortError');
  assert.deepStrictEqual(consumer.worker.cancelled, ['The worker closed.']);
  assert.deepStrictEqual(records, ['queue.close_abandoned']);
  assert.strictEqual((await running).name, 'WaitingError');
  // Its signal aborted closes the worker.
  const stop = new AbortController();
  const stopped = driver.consume(async () => ({ type: 'ack' }), { signal: stop.signal });
  stop.abort();
  await new Promise(setImmediate);
  assert.strictEqual(stopped.worker.closed, 1);
  await stopped.close();
  // A close that rejects when the signal aborts goes unheard.
  const later = new AbortController();
  const rejecting = driver.consume(async () => ({ type: 'ack' }), { signal: later.signal });
  rejecting.worker.closeWith = Promise.reject(new Error('closed already'));
  later.abort();
  await new Promise(setImmediate);
  assert.strictEqual(rejecting.worker.closed, 1);
});

test('BullMQ: each outcome becomes what BullMQ takes', async () => {
  const strategy = createBullMQBackoffStrategy();
  const processorOf = (outcome, options) => createBullMQProcessor(async () => outcome, options);
  assert.deepStrictEqual(await processorOf({ type: 'ack', result: { ok: 1 } })(fakeJob()), {
    ok: 1,
  });
  assert.strictEqual(await processorOf({ type: 'ack' })(fakeJob()), null);
  // A retry spends the attempt, its delay read back by the strategy.
  const retry = await failureOf(
    processorOf({ type: 'retry', delayMilliseconds: 4321, code: 'http.503', reason: 'busy' })(
      fakeJob(),
    ),
  );
  assert.strictEqual(retry.message, 'http.503: busy');
  assert.strictEqual(strategy(1, MAILER_BACKOFF_TYPE, retry), 4321);
  assert.strictEqual(strategy(2, MAILER_BACKOFF_TYPE, new Error('other')), 2000);
  assert.strictEqual(strategy(3, MAILER_BACKOFF_TYPE), 3000);
  assert.throws(() => strategy(1, 'custom'), /Unknown backoff strategy custom/);
  assert.throws(() => createBullMQBackoffStrategy(1), /must be a function/);
  // A failure is unrecoverable, its addresses redacted.
  const fail = await failureOf(
    processorOf({ type: 'fail', code: 'x.rejected', reason: 'for ada@example.com' })(fakeJob()),
  );
  assert.strictEqual(fail.name, 'UnrecoverableError');
  assert.doesNotMatch(fail.message, /ada@example\.com/);
  // A queue-wide retry rate limits the queue, without an attempt.
  const limits = [];
  const limited = await failureOf(
    processorOf(
      { type: 'retry', delayMilliseconds: 900, code: 'rate', reason: 'r', scope: 'queue' },
      { rateLimit: async (ms) => limits.push(ms) },
    )(fakeJob()),
  );
  assert.deepStrictEqual([limited.message, limits], ['bullmq:rateLimitExceeded', [900]]);
  // Without a rate limit, it is a retry of the job.
  const unlimited = await failureOf(
    processorOf({
      type: 'retry',
      delayMilliseconds: 900,
      code: 'rate',
      reason: 'r',
      scope: 'queue',
    })(fakeJob()),
  );
  assert.strictEqual(strategy(1, MAILER_BACKOFF_TYPE, unlimited), 900);
  const invalid = await failureOf(processorOf({ type: 'nope' })(fakeJob()));
  assert.strictEqual(invalid.name, 'UnrecoverableError');
});

test('BullMQ: a released job goes back without spending an attempt', async () => {
  const processorOf = (outcome) => createBullMQProcessor(async () => outcome);
  const delayedJob = fakeJob();
  const delayed = await failureOf(
    processorOf({ type: 'release', delayMilliseconds: 500 })(delayedJob, 'tok'),
  );
  assert.strictEqual(delayed.name, 'DelayedError');
  assert.strictEqual(delayedJob.moves[0][0], 'delayed');
  assert.strictEqual(delayedJob.moves[0][2], 'tok');
  const waitingJob = fakeJob();
  const waiting = await failureOf(processorOf({ type: 'release' })(waitingJob, 'tok'));
  assert.deepStrictEqual([waiting.name, waitingJob.moves], ['WaitingError', [['wait', 'tok']]]);
  // An old BullMQ without moveToDelayed waits instead; without a token, a retry.
  const old = fakeJob({ moveToDelayed: undefined });
  assert.strictEqual(
    (await failureOf(processorOf({ type: 'release', delayMilliseconds: 5 })(old, 'tok'))).name,
    'WaitingError',
  );
  const tokenless = await failureOf(
    processorOf({ type: 'release', delayMilliseconds: 10 })(fakeJob()),
  );
  assert.strictEqual(createBullMQBackoffStrategy()(1, MAILER_BACKOFF_TYPE, tokenless), 1000);
  const bare = fakeJob({ moveToDelayed: undefined, moveToWait: undefined });
  assert.strictEqual(
    (await failureOf(processorOf({ type: 'release' })(bare, 'tok'))).message,
    'queue.released: released to the queue',
  );
});

test('BullMQ: the processor gives the handler the run of the job and every signal', async (t) => {
  const warnings = [];
  const listener = (warning) => warnings.push(warning.code);
  process.on('warning', listener);
  t.after(() => process.off('warning', listener));
  const runs = [];
  const outer = new AbortController();
  const processor = createBullMQProcessor(
    async (job, signal) => {
      runs.push({ job, signal });
      return { type: 'ack' };
    },
    { signal: outer.signal },
  );
  const bullmqSignal = new AbortController();
  await processor(
    fakeJob({ attemptsMade: 2, stalledCounter: 1, opts: {} }),
    'tok',
    bullmqSignal.signal,
  );
  assert.deepStrictEqual(runs[0].job, {
    id: 'j1',
    name: 'mail',
    data: { n: 1 },
    attempt: 3,
    maxAttempts: 1,
    enqueuedAt: 1000,
    redelivered: true,
    redeliveries: 1,
  });
  bullmqSignal.abort('bullmq');
  assert.strictEqual(runs[0].signal.reason, 'bullmq');
  await processor(fakeJob());
  processor.shutdown('closing');
  assert.strictEqual(runs[1].signal.reason, 'closing');
  // A handler that throws is retried, and told.
  const throwing = createBullMQProcessor(async () => {
    throw new Error('bug');
  });
  const error = await failureOf(throwing(fakeJob({ attemptsMade: 1 })));
  assert.strictEqual(createBullMQBackoffStrategy()(2, MAILER_BACKOFF_TYPE, error), 2000);
  await new Promise(setImmediate);
  assert.ok(warnings.includes('MAILER_QUEUE_HANDLER_THREW'));
  assert.throws(() => createBullMQProcessor(), /needs a handler/);
  assert.throws(
    () => createBullMQProcessor(async () => {}, { rateLimit: 1 }),
    /rateLimit must be a function/,
  );
});

test('BullMQ: a queue-wide retry rate limits through the queue, or the worker of an old BullMQ', async () => {
  const bullmq = fakeBullMQ();
  const driver = createBullMQDriver({
    bullmq,
    workerOptions: { limiter: { max: 10, duration: 1000 } },
  });
  const outcome = {
    type: 'retry',
    delayMilliseconds: 250,
    code: 'rate',
    reason: 'r',
    scope: 'queue',
  };
  const consumer = driver.consume(async () => outcome);
  await failureOf(consumer.worker.processor(fakeJob()));
  assert.deepStrictEqual(bullmq.queues[0].limits, [250]);
  bullmq.queues[0].rateLimit = undefined;
  const limits = [];
  consumer.worker.rateLimit = async (ms) => limits.push(ms);
  await failureOf(consumer.worker.processor(fakeJob()));
  assert.deepStrictEqual(limits, [250]);
});

test('BullMQ: the driver checks its options', () => {
  const bullmq = fakeBullMQ();
  const cases = [
    [{}, /needs bullmq/],
    [{ bullmq: { Queue: {} } }, /needs bullmq/],
    [{ bullmq: { Queue: bullmq.Queue, Worker: {} } }, /Worker must be the Worker class/],
    [{ bullmq, detectDuplicates: 'yes' }, /detectDuplicates/],
    [{ bullmq, queueName: '' }, /queueName/],
    [{ bullmq, jobOptions: 1 }, /jobOptions must be an object/],
    [{ bullmq, jobOptions: { attempts: 3 } }, /jobOptions\.attempts is set by the BullMQ driver/],
    [{ bullmq, jobOptions: { jobId: 'x' } }, /jobOptions\.jobId/],
    [{ bullmq, workerOptions: { concurrency: 2 } }, /workerOptions\.concurrency/],
    [{ bullmq, priorities: { high: 0 } }, /priorities\.high/],
    [{ bullmq, priorities: { low: 2_097_152 } }, /priorities\.low/],
  ];
  for (const [options, pattern] of cases) {
    assert.throws(() => createBullMQDriver(options), pattern);
  }
  assert.throws(() => createBullMQDriver(), /needs bullmq/);
  const driver = createBullMQDriver({ bullmq, priorities: { high: 10 } });
  assert.throws(() => driver.consume(async () => {}, { concurrency: 0 }), /concurrency/);
  assert.strictEqual(typeof driver.createProcessor(async () => ({ type: 'ack' })), 'function');
});

test('BullMQ: a job done with keeps its version and hash, not its message, unless told', async (t) => {
  const warnings = [];
  const listener = (warning) => warnings.push(warning.code);
  process.on('warning', listener);
  t.after(() => process.off('warning', listener));
  const data = { v: 1, hash: 'h1', to: [{ address: 'ada@example.com' }] };
  const run = async (outcome, options) => {
    const job = fakeJob({ data: { ...data } });
    let thrown;
    const result = await createBullMQProcessor(async () => outcome, options)(job, 'tok').catch(
      (error) => {
        thrown = error;
      },
    );
    return { job, result, thrown };
  };
  const acked = await run({ type: 'ack', result: { provider: 'p' } });
  assert.deepStrictEqual(acked.result, { provider: 'p' });
  assert.deepStrictEqual(acked.job.data, { v: 1, hash: 'h1' });
  const kept = await run({ type: 'ack' }, { retainData: 'all' });
  assert.deepStrictEqual(kept.job.data, data);
  const failed = await run({ type: 'fail', code: 'x', reason: 'y' });
  assert.strictEqual(failed.thrown.name, 'UnrecoverableError');
  assert.deepStrictEqual(failed.job.data, data);
  const none = await run({ type: 'fail', code: 'x', reason: 'y' }, { retainData: 'none' });
  assert.deepStrictEqual(none.job.data, { v: 1, hash: 'h1' });
  // A store that fails to drop it leaves the send acknowledged, and tells.
  const job = fakeJob({
    data: { ...data },
    updateData: async () => {
      throw new Error('READONLY');
    },
  });
  assert.strictEqual(await createBullMQProcessor(async () => ({ type: 'ack' }))(job, 'tok'), null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(warnings.includes('MAILER_QUEUE_RETAIN_FAILED'));
  assert.throws(() => createBullMQProcessor(async () => ({}), { retainData: true }), /retainData/);
  const bullmq = fakeBullMQ();
  assert.throws(
    () => createBullMQDriver({ bullmq: { Queue: bullmq.Queue }, retainData: 'x' }),
    /retainData/,
  );
});

test('BullMQ: the retention of jobs is the queue’s, as on every driver', async () => {
  const bullmq = fakeBullMQ();
  const driver = createBullMQDriver({ bullmq });
  await driver.enqueue(requestOf());
  const [queue] = bullmq.queues;
  assert.deepStrictEqual(
    [queue.added[0].opts.removeOnComplete, queue.added[0].opts.removeOnFail],
    [{ age: 86_400 }, { age: 604_800 }],
  );
  const short = fakeBullMQ();
  await createBullMQDriver({
    bullmq: short,
    dedupeWindowSeconds: 3600,
    retainFailedSeconds: 7200,
  }).enqueue(requestOf());
  const { opts } = short.queues[0].added[0];
  assert.deepStrictEqual(
    [opts.removeOnComplete, opts.removeOnFail],
    [{ age: 3600 }, { age: 7200 }],
  );
  assert.throws(
    () => createBullMQDriver({ bullmq, dedupeWindowSeconds: -1 }),
    /dedupeWindowSeconds/,
  );
});

test('BullMQ: a job BullMQ gives up itself is told to the audit as of unknown delivery', async () => {
  const { createMemoryAuditSink } = require('../../src/audit/index.js');
  const bullmq = fakeBullMQ();
  const audit = createMemoryAuditSink();
  const driver = createBullMQDriver({ bullmq });
  const consumer = driver.consume(async () => ({ type: 'ack' }), { audit });
  const [worker] = bullmq.workers;
  const job = fakeJob({ data: { v: 1, correlationId: 'order-42' }, attemptsMade: 1 });
  worker.emit('failed', job, new Error('job stalled more than allowable limit'));
  await new Promise(setImmediate);
  const [event] = audit.events;
  assert.deepStrictEqual(
    [event.state, event.correlationId, event.jobId, event.attempt, event.error.code],
    ['delivery_unknown', 'order-42', 'j1', 1, 'queue.lost'],
  );
  // What the processor threw itself is the handler's, told already.
  const { retryError } = require('../../src/bullmq/backoff.js');
  worker.emit('failed', job, retryError({ code: 'x', reason: 'y', delayMilliseconds: 1 }));
  await new Promise(setImmediate);
  assert.strictEqual(audit.events.length, 1);
  await consumer.close();
});

test('BullMQ: enqueueMany reads its jobs back many at once to tell duplicates', async () => {
  const bullmq = fakeBullMQ();
  const driver = createBullMQDriver({ bullmq, detectDuplicates: 'bulk' });
  const [queue] = bullmq.queues;
  let inFlight = 0;
  let most = 0;
  const getJob = queue.getJob.bind(queue);
  queue.getJob = async (id) => {
    inFlight++;
    most = Math.max(most, inFlight);
    await new Promise(setImmediate);
    inFlight--;
    return getJob(id);
  };
  await driver.enqueue(requestOf({ id: 'held' }));
  const requests = [];
  for (let index = 0; index < 40; index++) requests.push(requestOf({ id: `j${index}` }));
  requests.push(requestOf({ id: 'held', enqueuedAt: 2000 }));
  requests.push(requestOf({ id: 'plain', unique: false }));
  const results = await driver.enqueueMany(requests);
  assert.strictEqual(results.length, 42);
  assert.deepStrictEqual(results[40], { id: 'held', duplicate: true, existingHash: 'h1' });
  assert.deepStrictEqual(results[41], { id: 'plain', duplicate: false });
  assert.strictEqual(results[0].duplicate, false);
  // At most 32 at once, more than one.
  assert.ok(most > 1 && most <= 32, String(most));
});
