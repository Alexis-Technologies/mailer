// Not ported: tests of the memory queue and the polling driver of ./queue.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  QueueLeaseLostError,
  createMemoryQueue,
  createPollingDriver,
} = require('../../src/queue/index.js');
const { manualClock } = require('../helpers/queue/clock.js');

const requestOf = (id, extra = {}) => ({
  id,
  name: 'mail',
  data: { n: id },
  hash: `h-${id}`,
  priority: 'normal',
  maxAttempts: 3,
  enqueuedAt: 0,
  unique: true,
  ...extra,
});

// Runs the consumer until the queue drains, recording the order of the runs.
const consumeAll = async (queue, handler, options = {}) => {
  const consumer = queue.consume(handler, options);
  await queue.drain();
  await consumer.close();
};

test('Queue: the memory queue runs jobs by priority, then time, then order', async () => {
  const clock = manualClock(1000);
  const queue = createMemoryQueue({ now: clock.now, sleep: clock.sleep });
  await queue.enqueue(requestOf('low', { priority: 'low', enqueuedAt: 1 }));
  await queue.enqueue(requestOf('n1', { enqueuedAt: 3 }));
  await queue.enqueue(requestOf('n0', { enqueuedAt: 2 }));
  await queue.enqueue(requestOf('high', { priority: 'high', enqueuedAt: 4 }));
  await queue.enqueue(requestOf('n2', { enqueuedAt: 2 }));
  const order = [];
  await consumeAll(queue, async (job) => {
    order.push(job.id);
    return { type: 'ack' };
  });
  assert.deepStrictEqual(order, ['high', 'n0', 'n2', 'n1', 'low']);
  assert.deepStrictEqual(
    queue.list().map((job) => job.state),
    ['completed', 'completed', 'completed', 'completed', 'completed'],
  );
});

test('Queue: a job enqueued again under its id is a duplicate while it is kept', async () => {
  const queue = createMemoryQueue({ retainFinished: 1 });
  assert.deepStrictEqual(await queue.enqueue(requestOf('a')), { id: 'a', duplicate: false });
  assert.deepStrictEqual(await queue.enqueue(requestOf('a', { hash: 'other' })), {
    id: 'a',
    duplicate: true,
    existingHash: 'h-a',
  });
  await queue.enqueue(requestOf('b'));
  await consumeAll(queue, async () => ({ type: 'ack', result: { ok: true } }));
  // Past what it retains of the finished jobs, an id is new again.
  assert.strictEqual(queue.get('a'), undefined);
  assert.deepStrictEqual(queue.get('b').result, { ok: true });
  assert.strictEqual((await queue.enqueue(requestOf('a'))).duplicate, false);
  await assert.rejects(queue.enqueue({ id: '' }), /takes a job request/);
  const full = createMemoryQueue({ maxJobs: 1 });
  await full.enqueue(requestOf('x'));
  await assert.rejects(full.enqueue(requestOf('y')), /holds 1 jobs/);
  // It gives back a copy of the data, never what was enqueued.
  const data = { nested: { value: 1 } };
  const own = createMemoryQueue();
  await own.enqueue(requestOf('c', { data }));
  data.nested.value = 2;
  assert.deepStrictEqual(own.get('c').data, { nested: { value: 1 } });
});

test('Queue: retries wait their delay, attempts count, a release spends none', async () => {
  const clock = manualClock(0);
  const queue = createMemoryQueue({
    now: clock.now,
    sleep: clock.sleep,
    pollIntervalMilliseconds: 100,
  });
  await queue.enqueue(requestOf('a', { maxAttempts: 3 }));
  const runs = [];
  let released = false;
  const consumer = queue.consume(async (job) => {
    runs.push([job.attempt, clock.now()]);
    if (!released) {
      released = true;
      return { type: 'release', delayMilliseconds: 50 };
    }
    return { type: 'retry', delayMilliseconds: 500, code: 'x', reason: 'busy' };
  });
  await queue.drain();
  assert.strictEqual(queue.get('a').state, 'delayed');
  clock.advance(50);
  queue.wake();
  await queue.drain();
  clock.advance(500);
  queue.wake();
  await queue.drain();
  clock.advance(500);
  queue.wake();
  await queue.drain();
  await consumer.close();
  // The release ran the first attempt again; the third retry failed the job.
  assert.deepStrictEqual(runs, [
    [1, 0],
    [1, 50],
    [2, 550],
    [3, 1050],
  ]);
  const job = queue.get('a');
  assert.deepStrictEqual(
    [job.state, job.attempt, job.failure.code],
    ['failed', 3, 'queue.attempts_exhausted'],
  );
});

test('Queue: a job is not run before its time, and a queue-wide retry pauses the queue', async () => {
  const clock = manualClock(0);
  const queue = createMemoryQueue({
    now: clock.now,
    sleep: clock.sleep,
    pollIntervalMilliseconds: 1000,
  });
  await queue.enqueue(requestOf('later', { availableAt: 2000 }));
  await queue.enqueue(requestOf('now'));
  await queue.enqueue(requestOf('next'));
  const runs = [];
  const consumer = queue.consume(async (job) => {
    runs.push([job.id, clock.now()]);
    if (job.id === 'now') {
      return { type: 'retry', delayMilliseconds: 300, code: 'rate', reason: 'r', scope: 'queue' };
    }
    return { type: 'ack' };
  });
  await queue.drain();
  assert.deepStrictEqual(runs, [['now', 0]]);
  clock.advance(300);
  queue.wake();
  await queue.drain();
  // Paused, nothing ran; then the job ready the longest goes first.
  assert.deepStrictEqual(runs.slice(1), [
    ['next', 300],
    ['now', 300],
  ]);
  clock.advance(1700);
  queue.wake();
  await queue.drain();
  await consumer.close();
  assert.deepStrictEqual(runs.at(-1), ['later', 2000]);
});

test('Queue: a job whose lease ran out comes back, redelivered, and its late settle is ignored', async () => {
  const clock = manualClock(0);
  const queue = createMemoryQueue({ now: clock.now, sleep: clock.sleep, leaseMilliseconds: 1000 });
  await queue.enqueue(requestOf('a'));
  let release;
  const first = new Promise((resolve) => {
    release = resolve;
  });
  const seen = [];
  const consumer = queue.consume(
    async (job, signal) => {
      seen.push([job.attempt, job.redelivered]);
      if (seen.length === 1) {
        await first;
        return { type: 'ack', result: { from: 'first' } };
      }
      return { type: 'ack', result: { from: 'second' } };
    },
    { concurrency: 2 },
  );
  await new Promise(setImmediate);
  // The lease is not kept (the keeper runs on a real timer), and runs out.
  clock.advance(1001);
  queue.wake();
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  await queue.drain();
  await consumer.close();
  assert.deepStrictEqual(seen, [
    [1, false],
    [1, true],
  ]);
  assert.deepStrictEqual(queue.get('a').result, { from: 'second' });
});

test('Queue: the polling driver keeps a lease while its job runs, and aborts it when lost', async () => {
  const leases = [];
  let extended = 0;
  let kept = true;
  const settled = [];
  const source = {
    id: 'fake-source',
    enqueue: async () => ({ id: 'x', duplicate: false }),
    reserve: async () => {
      if (leases.length > 0) return {};
      const lease = {
        job: { id: 'j', name: 'mail', data: {}, attempt: 1, maxAttempts: 1, redelivered: false },
        token: 't',
      };
      leases.push(lease);
      return { lease };
    },
    extend: async () => {
      extended++;
      return kept;
    },
    ack: async (lease) => settled.push(['ack', lease.token]),
    retry: async () => settled.push(['retry']),
    fail: async (lease, failure) => settled.push(['fail', failure.code]),
    release: async () => settled.push(['release']),
  };
  const driver = createPollingDriver(source, {
    leaseMilliseconds: 30,
    pollIntervalMilliseconds: 5,
  });
  assert.strictEqual(driver.id, 'fake-source');
  assert.deepStrictEqual(await driver.enqueue({}), { id: 'x', duplicate: false });
  let reason;
  const consumer = driver.consume(async (job, signal) => {
    await new Promise((resolve) => setTimeout(resolve, 35));
    kept = false;
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    reason = signal.reason;
    return { type: 'ack' };
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  await consumer.close();
  assert.ok(extended >= 2);
  assert.ok(reason instanceof QueueLeaseLostError);
  // The run of a lost lease is not settled.
  assert.deepStrictEqual(settled, []);
});

test('Queue: the polling driver settles every outcome, and survives its source failing', async (t) => {
  const warnings = [];
  const listener = (warning) => warnings.push(warning.code);
  process.on('warning', listener);
  t.after(() => process.off('warning', listener));
  const outcomes = [
    { type: 'ack', result: { a: 1 } },
    { type: 'retry', delayMilliseconds: 10, code: 'c', reason: 'r', scope: 'queue' },
    { type: 'fail', code: 'f', reason: 'r' },
    { type: 'release' },
    { type: 'release', delayMilliseconds: 5 },
    'throw',
    { type: 'nonsense' },
    { type: 'ack' },
  ];
  const settled = [];
  let reserveFailed = false;
  let index = 0;
  const now = () => 1000;
  const source = {
    id: 's',
    enqueue: async () => ({}),
    reserve: async () => {
      if (!reserveFailed) {
        reserveFailed = true;
        throw new Error('store down');
      }
      if (index >= outcomes.length) return { nextAvailableAt: 1500 };
      const attempt = index === 1 ? 1 : 2;
      return { lease: { job: { id: `j${index}`, attempt, maxAttempts: 2 }, token: `t${index}` } };
    },
    extend: async () => true,
    ack: async (lease, result) => {
      settled.push(['ack', lease.token, result]);
      if (lease.token === 't7') throw new Error('ack failed');
    },
    retry: async (lease, availableAt, failure) =>
      settled.push(['retry', availableAt, failure.code]),
    fail: async (lease, failure) => settled.push(['fail', failure.code]),
    release: async (lease, availableAt) => settled.push(['release', availableAt]),
    pause: async (until) => settled.push(['pause', until]),
  };
  const driver = createPollingDriver(source, {
    pollIntervalMilliseconds: 2,
    now,
    defaultRetryDelayMilliseconds: 7,
  });
  const consumer = driver.consume(async () => {
    const outcome = outcomes[index++];
    if (outcome === 'throw') throw new Error('handler bug');
    return outcome;
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  await consumer.close();
  assert.deepStrictEqual(settled, [
    ['ack', 't0', { a: 1 }],
    ['pause', 1010],
    ['retry', 1010, 'c'],
    ['fail', 'f'],
    ['release', undefined],
    ['release', 1005],
    // The handler threw on its second attempt of two: the retry it gets fails it.
    ['fail', 'queue.attempts_exhausted'],
    ['fail', 'queue.invalid_outcome'],
    ['ack', 't7', undefined],
  ]);
  assert.ok(warnings.includes('MAILER_QUEUE_HANDLER_THREW'));
});

test('Queue: closing waits for the jobs in flight, then aborts them past its timeout', async () => {
  const queue = createMemoryQueue({ pollIntervalMilliseconds: 5 });
  await queue.enqueue(requestOf('slow'));
  let aborted;
  const consumer = queue.consume(
    (job, signal) =>
      new Promise((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = signal.reason;
            resolve({ type: 'release' });
          },
          { once: true },
        );
      }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  await consumer.close({ timeoutMilliseconds: 10 });
  assert.strictEqual(aborted?.name, 'AbortError');
  // Given back: not attempted, its attempt not spent.
  assert.deepStrictEqual([queue.get('slow').state, queue.get('slow').attempt], ['waiting', 0]);
  // A consumer whose signal aborts stops too.
  const stop = new AbortController();
  const stopped = queue.consume(async () => ({ type: 'ack' }), { signal: stop.signal });
  stop.abort();
  await stopped.close();
  const already = new AbortController();
  already.abort();
  await queue.consume(async () => ({ type: 'ack' }), { signal: already.signal }).close();
});

test('Queue: the polling driver checks its source and options', () => {
  assert.throws(() => createPollingDriver({}), /has enqueue/);
  const source = {
    id: 1,
    enqueue() {},
    reserve() {},
    extend() {},
    ack() {},
    retry() {},
    fail() {},
    release() {},
  };
  assert.throws(() => createPollingDriver(source), /has an id/);
  const named = { ...source, id: 's' };
  assert.throws(() => createPollingDriver(named, { leaseMilliseconds: 0 }), /leaseMilliseconds/);
  assert.throws(() => createPollingDriver(named, { sleep: 1 }), /sleep/);
  const driver = createPollingDriver(named);
  assert.throws(() => driver.consume(), /needs a handler/);
  assert.throws(() => driver.consume(() => {}, { concurrency: 0 }), /concurrency/);
  assert.throws(() => createMemoryQueue({ maxJobs: 0 }), /maxJobs/);
  assert.throws(() => createMemoryQueue({ now: 1 }), /now/);
});

test('Queue: a job that runs longer than its lease keeps it, and runs once', async () => {
  const queue = createMemoryQueue({ leaseMilliseconds: 30, pollIntervalMilliseconds: 5 });
  await queue.enqueue(requestOf('long'));
  const runs = [];
  const consumer = queue.consume(
    async (job) => {
      runs.push(job.redelivered);
      await new Promise((resolve) => setTimeout(resolve, 90));
      return { type: 'ack' };
    },
    { concurrency: 2 },
  );
  await queue.drain();
  await consumer.close();
  assert.deepStrictEqual(runs, [false]);
  assert.strictEqual(queue.get('long').state, 'completed');
});

test('Queue: the memory queue lends each of many jobs without looking through them all', async () => {
  // Looking through every open job on each reserve made draining 30000 of
  // them take some 9e8 steps: seconds, where heaps take milliseconds.
  const { source } = createMemoryQueue({ now: () => 0, retainFinished: 10 });
  const count = 30_000;
  for (let index = 0; index < count; index++) {
    await source.enqueue({
      id: `j${index}`,
      name: 'mail',
      data: {},
      hash: 'h',
      priority: index % 3 === 0 ? 'high' : 'normal',
      maxAttempts: 1,
      enqueuedAt: 0,
    });
  }
  const started = performance.now();
  let previous = 'high';
  for (let index = 0; index < count; index++) {
    const { lease } = await source.reserve(60_000);
    const rank = Number(lease.job.id.slice(1)) % 3 === 0 ? 'high' : 'normal';
    assert.ok(previous === rank || previous === 'high', 'high before normal');
    previous = rank;
    await source.ack(lease, null);
  }
  assert.deepStrictEqual(await source.reserve(60_000), {});
  assert.ok(performance.now() - started < 3000, `${performance.now() - started} ms`);
});

test('Queue: a settle its source fenced off is told, as the job may run twice', async () => {
  const records = [];
  const logger = { warn: (record, message) => records.push([message, record]) };
  let reserved = false;
  const source = {
    id: 'fenced',
    enqueue: async () => ({ id: 'x', duplicate: false }),
    reserve: async () => {
      if (reserved) return {};
      reserved = true;
      const job = {
        id: 'j',
        name: 'mail',
        data: {},
        attempt: 1,
        maxAttempts: 1,
        redelivered: false,
      };
      return { lease: { job, token: 't' } };
    },
    extend: async () => true,
    // The lease ran out between the run and its settling.
    ack: async () => false,
    retry: async () => true,
    fail: async () => true,
    release: async () => undefined,
  };
  const driver = createPollingDriver(source, { pollIntervalMilliseconds: 5, logger });
  const consumer = driver.consume(async () => ({ type: 'ack' }));
  while (records.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  await consumer.close();
  assert.deepStrictEqual(records[0], [
    'queue.settle_fenced',
    { component: 'queue', queue: 'fenced', jobId: 'j', outcome: 'ack' },
  ]);
});

test('Queue: a run whose lease cannot be extended stops before the lease runs out', async () => {
  let reserved = false;
  const settled = [];
  const records = [];
  const source = {
    id: 'unkept',
    enqueue: async () => ({ id: 'x', duplicate: false }),
    reserve: async () => {
      if (reserved) return {};
      reserved = true;
      const job = {
        id: 'j',
        name: 'mail',
        data: {},
        attempt: 1,
        maxAttempts: 1,
        redelivered: false,
      };
      return { lease: { job, token: 't' } };
    },
    // The store is out of reach: no extend answers.
    extend: async () => {
      throw new Error('connection reset');
    },
    ack: async () => settled.push('ack'),
    retry: async () => settled.push('retry'),
    fail: async () => settled.push('fail'),
    release: async () => settled.push('release'),
  };
  const logger = { warn: (record, message) => records.push(message) };
  const driver = createPollingDriver(source, {
    leaseMilliseconds: 60,
    pollIntervalMilliseconds: 5,
    logger,
  });
  const started = Date.now();
  let onStopped;
  const stoppedOnce = new Promise((resolve) => {
    onStopped = resolve;
  });
  const consumer = driver.consume(
    (job, signal) =>
      new Promise((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            onStopped({ reason: signal.reason, after: Date.now() - started });
            resolve({ type: 'ack' });
          },
          { once: true },
        );
      }),
  );
  const stopped = await Promise.race([
    stoppedOnce,
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
  await consumer.close({ timeoutMilliseconds: 50 });
  assert.ok(stopped?.reason instanceof QueueLeaseLostError);
  // Two keeps failed (at 20 and 40 ms): the third would come after the lease.
  assert.ok(stopped.after < 60, `${stopped.after} ms`);
  assert.deepStrictEqual(settled, []);
  assert.ok(records.includes('queue.lease.extend_failed'));
  assert.ok(records.includes('queue.lease.lost'));
});

test('Queue: a job done with keeps no data, unless told; its duplicates are still told', async () => {
  const cases = [
    [undefined, [false, true]],
    ['all', [true, true]],
    ['none', [false, false]],
  ];
  for (const [retainData, [completedKeeps, failedKeeps]] of cases) {
    const queue = createMemoryQueue({ retainData });
    await queue.enqueue(requestOf('done'));
    await queue.enqueue(requestOf('refused'));
    for (let index = 0; index < 2; index++) {
      const { lease } = await queue.source.reserve(1000);
      if (lease.job.id === 'done') await queue.source.ack(lease, null);
      else await queue.source.fail(lease, { code: 'x', reason: 'y' });
    }
    assert.strictEqual('data' in queue.get('done'), completedKeeps, `${retainData} done`);
    assert.strictEqual('data' in queue.get('refused'), failedKeeps, `${retainData} refused`);
    assert.deepStrictEqual(await queue.enqueue(requestOf('done')), {
      id: 'done',
      duplicate: true,
      existingHash: 'h-done',
    });
  }
  assert.throws(() => createMemoryQueue({ retainData: 'some' }), /retainData must be/);
});

test('Queue: the memory queue keeps a completed job for the window of duplicates, a failed one longer', async () => {
  const clock = manualClock(0);
  const queue = createMemoryQueue({
    now: clock.now,
    dedupeWindowSeconds: 60,
    retainFailedSeconds: 120,
  });
  await queue.enqueue(requestOf('done'));
  await queue.enqueue(requestOf('refused'));
  for (let index = 0; index < 2; index++) {
    const { lease } = await queue.source.reserve(1000);
    if (lease.job.id === 'done') await queue.source.ack(lease, null);
    else await queue.source.fail(lease, { code: 'x', reason: 'y' });
  }
  clock.advance(59_999);
  assert.strictEqual((await queue.enqueue(requestOf('done'))).duplicate, true);
  clock.advance(1);
  // Past its window, the key is forgotten: the same id is a new job.
  assert.strictEqual((await queue.enqueue(requestOf('done'))).duplicate, false);
  assert.strictEqual(queue.get('refused').state, 'failed');
  clock.advance(60_000);
  assert.strictEqual(queue.get('refused'), undefined);
  // The count bound drops the oldest finished first, of either kind.
  const small = createMemoryQueue({ now: clock.now, retainFinished: 1 });
  await small.enqueue(requestOf('a'));
  await small.enqueue(requestOf('b'));
  await small.source.fail((await small.source.reserve(1000)).lease, { code: 'x', reason: 'y' });
  await small.source.ack((await small.source.reserve(1000)).lease, null);
  assert.deepStrictEqual(
    small.list().map((job) => job.id),
    ['b'],
  );
  assert.throws(() => createMemoryQueue({ dedupeWindowSeconds: 0 }), /dedupeWindowSeconds/);
});

test('Queue: a change wakes one waiting lane, not every lane, and is kept when all are busy', async () => {
  const clock = manualClock(0);
  let listener;
  let reserves = 0;
  const source = {
    id: 'waking',
    enqueue: async () => ({ id: 'x', duplicate: false }),
    reserve: async () => {
      reserves++;
      return {};
    },
    extend: async () => true,
    ack: async () => true,
    retry: async () => true,
    fail: async () => true,
    release: async () => true,
    subscribe: (wake) => {
      listener = wake;
      return () => {};
    },
  };
  const driver = createPollingDriver(source, {
    now: clock.now,
    sleep: clock.sleep,
    pollIntervalMilliseconds: 60_000,
  });
  const consumer = driver.consume(async () => ({ type: 'ack' }), { concurrency: 4 });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await settle();
  assert.strictEqual(reserves, 4);
  listener();
  await settle();
  // One job enqueued: one lane reserves, three wait on.
  assert.strictEqual(reserves, 5);
  listener();
  listener();
  await settle();
  assert.strictEqual(reserves, 7);
  await consumer.close({ timeoutMilliseconds: 10 });
});
