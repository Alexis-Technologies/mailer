// Not ported: tests of ./ratelimit, ported from unemail's rate limit, against a
// fake transport, a manual clock and mocked timers.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { RateLimitTransport } = require('../../src/ratelimit/index.js');
const { collect, fakeTransport } = require('../helpers/decorators/fake.js');

const message = (subject = 'Hello', to = 'b@example.com') =>
  createMessage({ from: 'a@example.com', to, subject, content: { text: 'x' } });

// A clock that moves the mocked timers with it.
const timeline = (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // Node resets the timers after each test; Deno keeps them enabled.
  t.after(() => t.mock.timers.reset());
  let time = 0;
  return {
    now: () => time,
    advance: async (ms) => {
      time += ms;
      t.mock.timers.tick(ms);
      // Lets the promises settled by the timers run, which setImmediate,
      // not mocked, follows.
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
};

test('RateLimit: a burst goes at once, then one message per refill, in order', async (t) => {
  const clock = timeline(t);
  const inner = fakeTransport();
  const limiter = new RateLimitTransport(inner, { limit: 2, intervalMs: 1000, now: clock.now });
  const order = [];
  const sends = [];
  for (let i = 0; i < 5; i++) {
    sends.push(limiter.send(message(`m${i}`)).then(() => order.push(i)));
  }
  await clock.advance(0);
  assert.deepStrictEqual(order, [0, 1]);
  await clock.advance(499);
  assert.deepStrictEqual(order, [0, 1]);
  await clock.advance(1);
  assert.deepStrictEqual(order, [0, 1, 2]);
  await clock.advance(1000);
  assert.deepStrictEqual(order, [0, 1, 2, 3, 4]);
  await Promise.all(sends);
  assert.strictEqual(inner.calls.length, 5);
});

test('RateLimit: the longest wait counts from the arrival, behind the queue', async (t) => {
  const clock = timeline(t);
  const inner = fakeTransport();
  const limiter = new RateLimitTransport(inner, {
    limit: 1,
    intervalMs: 1000,
    maxWaitMs: 1500,
    now: clock.now,
  });
  const first = limiter.send(message());
  const second = limiter.send(message());
  // Changed in the port: unemail counted the wait only from the turn of a
  // message, so this one would have waited behind the second as well.
  const third = await limiter.send(message());
  assert.strictEqual(third.successful, false);
  assert.strictEqual(third.retryable, true);
  assert.strictEqual(third.errors[0].category, 'rate-limit');
  assert.strictEqual(third.errors[0].code, 'ratelimit.limited');
  assert.strictEqual(third.errors[0].retryAfterMilliseconds, 2000);
  await clock.advance(1000);
  await Promise.all([first, second]);
  assert.strictEqual(inner.calls.length, 2);
});

test('RateLimit: reject mode answers at once, and a cost over the burst is refused', async (t) => {
  const clock = timeline(t);
  const inner = fakeTransport();
  const recipients = (m) => m.recipients.length;
  const limiter = new RateLimitTransport(inner, {
    limit: 3,
    mode: 'reject',
    cost: recipients,
    now: clock.now,
  });
  assert.strictEqual(
    (await limiter.send(message('a', ['x@example.com', 'y@example.com']))).successful,
    true,
  );
  const limited = await limiter.send(message('b', ['x@example.com', 'y@example.com']));
  assert.strictEqual(limited.errors[0].retryAfterMilliseconds, 334);
  // Changed in the port: unemail cut a cost over the capacity to it.
  const tooBig = await limiter.send(
    message('c', ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']),
  );
  assert.strictEqual(tooBig.errors[0].category, 'configuration');
  assert.strictEqual(tooBig.errors[0].code, 'ratelimit.cost_over_capacity');
  assert.strictEqual(tooBig.retryable, false);
  const invalid = new RateLimitTransport(inner, { limit: 1, cost: () => -1, now: clock.now });
  assert.strictEqual((await invalid.send(message())).errors[0].code, 'ratelimit.invalid_cost');
  assert.strictEqual(inner.calls.length, 1);
});

test('RateLimit: an abort takes a waiting message out of the queue', async (t) => {
  const clock = timeline(t);
  const inner = fakeTransport();
  const limiter = new RateLimitTransport(inner, { limit: 1, now: clock.now });
  await limiter.send(message('first'));
  const controller = new AbortController();
  const waiting = limiter.send(message('aborted'), { signal: controller.signal });
  const after = limiter.send(message('after'));
  controller.abort(new Error('caller left'));
  // Changed in the port: unemail's sleep did not hear the signal.
  await assert.rejects(waiting, /caller left/);
  await clock.advance(1000);
  await after;
  assert.deepStrictEqual(
    inner.calls.map((call) => call.message.subject),
    ['first', 'after'],
  );
  await assert.rejects(
    limiter.send(message(), { signal: AbortSignal.abort(new Error('already')) }),
    /already/,
  );
});

test('RateLimit: a bucket per key, and full idle ones are dropped', async (t) => {
  const clock = timeline(t);
  const inner = fakeTransport();
  const limiter = new RateLimitTransport(inner, {
    limit: 1,
    mode: 'reject',
    key: (m) => m.recipients[0].address,
    maxKeys: 2,
    now: clock.now,
  });
  assert.strictEqual((await limiter.send(message('a', 'x@example.com'))).successful, true);
  assert.strictEqual((await limiter.send(message('b', 'y@example.com'))).successful, true);
  assert.strictEqual((await limiter.send(message('c', 'x@example.com'))).successful, false);
  await clock.advance(1000);
  // Both buckets are full again: the third key drops them.
  assert.strictEqual((await limiter.send(message('d', 'z@example.com'))).successful, true);
  assert.strictEqual((await limiter.send(message('e', 'z@example.com'))).successful, false);
  // A bucket still waiting to refill is kept, and the next sweep waits longer.
  assert.strictEqual((await limiter.send(message('f', 'w@example.com'))).successful, true);
  assert.strictEqual((await limiter.send(message('g', 'v@example.com'))).successful, true);
});

test('RateLimit: sendMany is throttled like as many sends, through the wrapped sendMany', async (t) => {
  const clock = timeline(t);
  const inner = fakeTransport(undefined, { readAhead: 1 });
  const limiter = new RateLimitTransport(inner, {
    limit: 2,
    maxWaitMs: 600,
    now: clock.now,
  });
  const batch = collect(limiter.sendMany([message('0'), message('1'), message('2'), message('3')]));
  await clock.advance(0);
  assert.strictEqual(inner.calls.length, 1);
  await clock.advance(500);
  await clock.advance(500);
  const receipts = await batch;
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.successful),
    [true, true, true, true],
  );
  assert.ok(inner.calls.every((call) => call.operation === 'sendMany'));
  // Over the longest wait, the rest is answered in place.
  const refused = await collect(
    new RateLimitTransport(fakeTransport(), { limit: 1, maxWaitMs: 0, now: clock.now }).sendMany([
      message(),
      message(),
    ]),
  );
  assert.deepStrictEqual(
    refused.map((receipt) => receipt.successful),
    [true, false],
  );
});

test('RateLimit: sendRaw, verify, dispose and the options', async (t) => {
  const clock = timeline(t);
  const inner = fakeTransport();
  const limiter = new RateLimitTransport(inner, { limit: 1, mode: 'reject', now: clock.now });
  const raw = { envelope: { from: 'a@example.com', to: ['b@example.com'] }, content: 'x' };
  assert.strictEqual((await limiter.sendRaw(raw)).successful, true);
  assert.strictEqual((await limiter.sendRaw(raw)).errors[0].category, 'rate-limit');
  await limiter.verify();
  assert.strictEqual(inner.verified, 1);
  await limiter[Symbol.asyncDispose]();
  assert.strictEqual(inner.disposed, 1);
  const plain = { id: 'plain', send: async () => ({ successful: true, messageId: 'p' }) };
  const bare = new RateLimitTransport(plain, { limit: 1 });
  assert.strictEqual((await bare.sendRaw(raw)).errors[0].category, 'configuration');
  await bare.verify();
  await bare[Symbol.asyncDispose]();
  let disposed = 0;
  await new RateLimitTransport({ ...plain, [Symbol.dispose]: () => disposed++ }, { limit: 1 })[
    Symbol.asyncDispose
  ]();
  assert.strictEqual(disposed, 1);
  assert.throws(() => new RateLimitTransport(inner, {}), /limit must be a positive number/);
  assert.throws(() => new RateLimitTransport(inner, { limit: 1, mode: 'drop' }), /mode/);
  assert.throws(() => new RateLimitTransport(inner, { limit: 1, maxWaitMs: -1 }), /maxWaitMs/);
  assert.throws(() => new RateLimitTransport(inner, { limit: 1, maxKeys: 0 }), /maxKeys/);
  assert.throws(() => new RateLimitTransport(inner, { limit: 1, key: 'tenant' }), /key must be/);
  const defaults = new RateLimitTransport(inner, { limit: 5 });
  assert.strictEqual(defaults.config.burst, 5);
  assert.strictEqual(defaults.config.intervalMs, 1000);
  assert.strictEqual(defaults.config.maxWaitMs, 30000);
  assert.strictEqual(defaults.config.mode, 'wait');
  assert.strictEqual(defaults.id, 'fake');
});

test('RateLimit: no more than maxKeys keys are held, the least used dropped first', async (t) => {
  // Before: maxKeys only started a sweep of the full buckets, so keys whose
  // buckets had not refilled were all kept, and the next sweep waited for
  // twice as many.
  const clock = timeline(t);
  const limiter = new RateLimitTransport(fakeTransport(), {
    limit: 1,
    intervalMs: 3_600_000,
    mode: 'reject',
    maxKeys: 2,
    key: (m) => m.recipients[0].address,
    now: clock.now,
  });
  const to = (address) => limiter.send(message('x', address));
  assert.strictEqual((await to('a@example.com')).successful, true);
  assert.strictEqual((await to('b@example.com')).successful, true);
  // a is limited for an hour; used again, it is the most recent.
  assert.strictEqual((await to('a@example.com')).successful, false);
  // c needs a place: b, the least used, goes, and starts full when it is back.
  assert.strictEqual((await to('c@example.com')).successful, true);
  assert.strictEqual((await to('a@example.com')).successful, false);
  assert.strictEqual((await to('b@example.com')).successful, true);
});

test('RateLimit: dispose stops the waits, and a later send is refused', async (t) => {
  // Before: the waiters stayed queued with their timer, and sent through the
  // disposed transport when their tokens came.
  const clock = timeline(t);
  const inner = fakeTransport();
  const limiter = new RateLimitTransport(inner, { limit: 1, intervalMs: 1000, now: clock.now });
  await limiter.send(message('first'));
  const waiting = limiter.send(message('second'));
  await limiter[Symbol.asyncDispose]();
  await assert.rejects(waiting, { name: 'AbortError' });
  await assert.rejects(limiter.send(message('third')), { name: 'AbortError' });
  await clock.advance(5000);
  assert.strictEqual(inner.calls.length, 1);
});

test('RateLimit: a signal that aborted between two messages of a batch stops the next', async (t) => {
  // Before: an aborted signal fires no event, so the next message waited and
  // took its tokens.
  const clock = timeline(t);
  const inner = fakeTransport();
  const limiter = new RateLimitTransport(inner, { limit: 1, intervalMs: 1000, now: clock.now });
  const controller = new AbortController();
  const receipts = limiter.sendMany([message('a'), message('b')], { signal: controller.signal });
  const iterator = receipts[Symbol.asyncIterator]();
  assert.strictEqual((await iterator.next()).value.successful, true);
  controller.abort(new Error('stop'));
  await assert.rejects(iterator.next(), /stop/);
  assert.strictEqual(inner.calls.length, 1);
});

test('RateLimit: processes that share a store share one limit', async (t) => {
  // Before: each process had its buckets, so N of them sent N times the
  // quota of the provider.
  const clock = timeline(t);
  const buckets = new Map();
  const calls = [];
  const store = {
    // A token bucket as a Redis script would keep it, on the clock of the test.
    take: async (key, cost, { limit, intervalMs, burst }) => {
      calls.push([key, cost, limit, intervalMs, burst]);
      const now = clock.now();
      const bucket = buckets.get(key) ?? { tokens: burst, at: now };
      bucket.tokens = Math.min(burst, bucket.tokens + ((now - bucket.at) * limit) / intervalMs);
      bucket.at = now;
      buckets.set(key, bucket);
      if (bucket.tokens >= cost) {
        bucket.tokens -= cost;
        return { taken: true };
      }
      return { taken: false, waitMs: ((cost - bucket.tokens) * intervalMs) / limit };
    },
  };
  const first = new RateLimitTransport(fakeTransport(), { limit: 1, intervalMs: 1000, store });
  const second = new RateLimitTransport(fakeTransport(), {
    limit: 1,
    intervalMs: 1000,
    mode: 'reject',
    store,
  });
  assert.strictEqual((await first.send(message())).successful, true);
  const refused = await second.send(message());
  assert.strictEqual(refused.errors[0].category, 'rate-limit');
  assert.strictEqual(refused.errors[0].retryAfterMilliseconds, 1000);
  // The first waits for the store's tokens, on the store's word.
  const waiting = first.send(message());
  // Lets the answer of the store come, and its wait start, before the clock moves.
  await clock.advance(0);
  await clock.advance(1000);
  assert.strictEqual((await waiting).successful, true);
  assert.deepStrictEqual(calls[0], ['', 1, 1, 1000, 1]);
  // Disposal stops a wait on the store.
  const held = first.send(message());
  await clock.advance(0);
  await first[Symbol.asyncDispose]();
  await assert.rejects(held, { name: 'AbortError' });
  assert.throws(
    () => new RateLimitTransport(fakeTransport(), { limit: 1, store: {} }),
    /take method/,
  );
});

test('RateLimit: a full bucket is dropped before one that is not, which is told', async (t) => {
  // Before: the least used bucket with no waiter was dropped, full or not, so
  // a limited key rotated out came back full, silently.
  const clock = timeline(t);
  const warned = [];
  t.mock.method(process, 'emitWarning', (_text, options) => warned.push(options?.code));
  const limiter = new RateLimitTransport(fakeTransport(), {
    limit: 1,
    intervalMs: 1000,
    mode: 'reject',
    maxKeys: 2,
    key: (m) => m.recipients[0].address,
    now: clock.now,
  });
  const to = (address) => limiter.send(message('x', address));
  assert.strictEqual((await to('a@example.com')).successful, true);
  await clock.advance(1000);
  assert.strictEqual((await to('b@example.com')).successful, true);
  // a has refilled and is the least used; b is not full: a goes, b stays.
  assert.strictEqual((await to('c@example.com')).successful, true);
  assert.strictEqual((await to('b@example.com')).successful, false);
  assert.deepStrictEqual(warned, []);
  // With no full bucket, the least used goes, and a warning says so.
  assert.strictEqual((await to('d@example.com')).successful, true);
  assert.deepStrictEqual(warned, ['MAILER_RATELIMIT_EVICTED']);
});

test('RateLimit: an abort between two messages stops the next though tokens are there', async () => {
  // Before: only a message that had to wait heard the aborted signal; one
  // whose tokens were there took them and went.
  const inner = fakeTransport();
  const limiter = new RateLimitTransport(inner, { limit: 10 });
  const controller = new AbortController();
  const receipts = limiter.sendMany([message('a'), message('b')], { signal: controller.signal });
  const iterator = receipts[Symbol.asyncIterator]();
  assert.strictEqual((await iterator.next()).value.successful, true);
  controller.abort(new Error('stop'));
  await assert.rejects(iterator.next(), /stop/);
  assert.strictEqual(inner.calls.length, 1);
});

test('RateLimit: maxQueue bounds the waiters, whatever maxWaitMs allows', async (t) => {
  // Before: with maxWaitMs Infinity, any number of messages waited.
  const clock = timeline(t);
  const limiter = new RateLimitTransport(fakeTransport(), {
    limit: 1,
    intervalMs: 1000,
    maxWaitMs: Infinity,
    maxQueue: 1,
    now: clock.now,
  });
  assert.strictEqual((await limiter.send(message('first'))).successful, true);
  const waiting = limiter.send(message('second'));
  const refused = await limiter.send(message('third'));
  assert.strictEqual(refused.successful, false);
  assert.strictEqual(refused.errors[0].category, 'rate-limit');
  assert.match(refused.errorMessages[0], /holds 1 messages waiting/);
  await clock.advance(1000);
  assert.strictEqual((await waiting).successful, true);
  assert.throws(
    () => new RateLimitTransport(fakeTransport(), { limit: 1, maxQueue: 0 }),
    /maxQueue/,
  );
});

test('RateLimit: a store that gives no wait is asked again after the rate, and waits are told', async (t) => {
  // Before: a store answering { taken: false } alone was asked again every
  // millisecond, a thousand round trips a second for each waiting message.
  const clock = timeline(t);
  let takes = 0;
  const records = [];
  const logger = { debug: (record) => records.push(record), info() {}, warn() {} };
  const limiter = new RateLimitTransport(fakeTransport(), {
    limit: 1,
    intervalMs: 1000,
    now: clock.now,
    logger,
    store: { take: () => ({ taken: ++takes > 2 }) },
  });
  const sending = limiter.send(message());
  // Lets the answer of the store come, and its wait start, before the clock moves.
  await clock.advance(0);
  await clock.advance(999);
  assert.strictEqual(takes, 1);
  await clock.advance(1);
  await clock.advance(1000);
  assert.strictEqual((await sending).successful, true);
  assert.strictEqual(takes, 3);
  const waited = records.find((record) => record.code === 'ratelimit.waited');
  assert.strictEqual(waited.waitedMs, 2000);
  // A local wait is told once its tokens are there.
  const local = new RateLimitTransport(fakeTransport(), {
    limit: 1,
    intervalMs: 1000,
    now: clock.now,
    logger,
  });
  records.length = 0;
  await local.send(message());
  const second = local.send(message());
  await clock.advance(1000);
  await second;
  assert.deepStrictEqual(
    records.map((record) => [record.code, record.waitedMs ?? record.waitMs]),
    [
      ['ratelimit.waiting', 1000],
      ['ratelimit.waited', 1000],
    ],
  );
});
