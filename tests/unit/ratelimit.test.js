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
