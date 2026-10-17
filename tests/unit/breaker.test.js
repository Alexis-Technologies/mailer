// Not ported: tests of ./breaker, ported from unemail's circuit breaker,
// against a fake transport.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { CircuitBreakerTransport } = require('../../src/breaker/index.js');
const { collect, failed, fakeTransport, sent } = require('../helpers/decorators/fake.js');

const message = (subject = 'Hello') =>
  createMessage({ from: 'a@example.com', to: 'b@example.com', subject, content: { text: 'x' } });

const clock = () => {
  let time = 0;
  return { now: () => time, advance: (ms) => (time += ms) };
};

const deferred = () => {
  let resolve;
  const promise = new Promise((_resolve) => {
    resolve = _resolve;
  });
  return { promise, resolve };
};

test('Breaker: failures of the provider in a row open the circuit; others do not count', async () => {
  const answers = ['network', 'timeout', 'validation', 'server-error', 'rate-limit', 'network'];
  const inner = fakeTransport((_m, index) =>
    index < answers.length ? failed(answers[index]) : sent('ok'),
  );
  const time = clock();
  const states = [];
  const breaker = new CircuitBreakerTransport(inner, {
    failureThreshold: 3,
    now: time.now,
    onStateChange: (state, previous) => states.push(`${previous}->${state}`),
  });
  // network, timeout: 2; validation answers, so the count starts again;
  // server-error: 1; rate-limit is no failure of health: 0; network: 1.
  for (let i = 0; i < answers.length; i++) await breaker.send(message());
  assert.strictEqual(breaker.state, 'closed');
  inner.calls.length = 0;
  const failing = fakeTransport(() => failed('service-unavailable'));
  const tripped = new CircuitBreakerTransport(failing, { failureThreshold: 2, now: time.now });
  await tripped.send(message());
  await tripped.send(message());
  assert.strictEqual(tripped.state, 'open');
  assert.deepStrictEqual(states, []);
});

test('Breaker: an open circuit answers at once, with the time left', async () => {
  const time = clock();
  const inner = fakeTransport(() => failed('network'));
  const breaker = new CircuitBreakerTransport(inner, {
    failureThreshold: 1,
    resetTimeoutMs: 10_000,
    now: time.now,
  });
  await breaker.send(message());
  time.advance(2_500);
  const refused = await breaker.send(message());
  assert.strictEqual(inner.calls.length, 1);
  assert.strictEqual(refused.successful, false);
  assert.strictEqual(refused.retryable, true);
  assert.strictEqual(refused.provider, 'fake');
  assert.strictEqual(refused.errors[0].category, 'service-unavailable');
  assert.strictEqual(refused.errors[0].code, 'breaker.open');
  assert.strictEqual(refused.errors[0].retryAfterMilliseconds, 7_500);
  assert.match(refused.errorMessages[0], /circuit of fake is open after 1 failures/);
});

test('Breaker: half-open lets one probe through, and its success closes the circuit', async () => {
  const time = clock();
  const probe = deferred();
  let failing = true;
  const inner = fakeTransport(() => (failing ? failed('network') : probe.promise));
  const states = [];
  const breaker = new CircuitBreakerTransport(inner, {
    failureThreshold: 1,
    resetTimeoutMs: 1_000,
    now: time.now,
    onStateChange: (state, previous) => states.push(`${previous}->${state}`),
  });
  await breaker.send(message());
  time.advance(1_000);
  assert.strictEqual(breaker.state, 'half-open');
  failing = false;
  const first = breaker.send(message('probe'));
  // Changed in the port: unemail let every send through while half-open.
  const second = await breaker.send(message('during the probe'));
  assert.strictEqual(second.errors[0].code, 'breaker.open');
  assert.strictEqual(second.errors[0].retryAfterMilliseconds, undefined);
  assert.strictEqual(inner.calls.length, 2);
  probe.resolve(sent('probe-ok'));
  assert.strictEqual((await first).messageId, 'probe-ok');
  assert.strictEqual(breaker.state, 'closed');
  assert.deepStrictEqual(states, ['closed->open', 'open->half-open', 'half-open->closed']);
});

test('Breaker: a failed or thrown probe opens it again; an abort frees the probe', async () => {
  const time = clock();
  const outcomes = [failed('network'), failed('timeout'), { throw: new Error('socket hang up') }];
  const inner = fakeTransport((_m, index, options) => {
    if (index < outcomes.length) return outcomes[index];
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason));
    });
  });
  const breaker = new CircuitBreakerTransport(inner, {
    failureThreshold: 1,
    resetTimeoutMs: 1_000,
    now: time.now,
  });
  await breaker.send(message());
  time.advance(1_000);
  await breaker.send(message());
  assert.strictEqual(breaker.state, 'open');
  time.advance(1_000);
  await assert.rejects(breaker.send(message()), /socket hang up/);
  assert.strictEqual(breaker.state, 'open');
  time.advance(1_000);
  const controller = new AbortController();
  const aborted = breaker.send(message(), { signal: controller.signal });
  controller.abort(new Error('caller gave up'));
  await assert.rejects(aborted, /caller gave up/);
  // The abort learned nothing: the next send is a probe again.
  assert.strictEqual(breaker.state, 'half-open');
  await assert.rejects(
    breaker.send(message(), { signal: AbortSignal.abort(new Error('already')) }),
    /already/,
  );
});

test('Breaker: sendMany keeps the batching of the wrapped transport and stops when it opens', async () => {
  const time = clock();
  const inner = fakeTransport((_m, index) => (index < 2 ? sent(`m${index}`) : failed('network')), {
    readAhead: 1,
  });
  const breaker = new CircuitBreakerTransport(inner, {
    failureThreshold: 2,
    resetTimeoutMs: 1_000,
    now: time.now,
  });
  const messages = [];
  for (let i = 0; i < 7; i++) messages.push(message(`m${i}`));
  const receipts = await collect(breaker.sendMany(messages));
  assert.strictEqual(receipts.length, 7);
  // Two go, two fail and open the circuit; the one read ahead goes too.
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.successful || receipt.errors[0].category),
    [true, true, 'network', 'network', 'network', 'service-unavailable', 'service-unavailable'],
  );
  assert.ok(inner.calls.every((call) => call.operation === 'sendMany'));
  assert.strictEqual(inner.calls.length, 5);
  // Half-open: the first message is the probe, the others wait for it.
  time.advance(1_000);
  const answer = await collect(breaker.sendMany([message('p'), message('q')]));
  assert.deepStrictEqual(
    answer.map((receipt) => receipt.successful || receipt.errors[0].code || 'network'),
    ['network', 'breaker.open'],
  );
  assert.strictEqual(breaker.state, 'open');
});

test('Breaker: a sendMany that throws counts, and fails the messages still out', async () => {
  const time = clock();
  const inner = fakeTransport(() => sent('x'), {
    overrides: {
      // oxlint-disable-next-line require-yield
      async *sendMany(messages) {
        await messages[Symbol.asyncIterator]().next();
        throw new Error('batch exploded');
      },
    },
  });
  const breaker = new CircuitBreakerTransport(inner, { failureThreshold: 1, now: time.now });
  await assert.rejects(collect(breaker.sendMany([message()])), /batch exploded/);
  assert.strictEqual(breaker.state, 'open');
  const empty = await collect(breaker.sendMany([]));
  assert.deepStrictEqual(empty, []);
});

test('Breaker: a custom isFailure, sendRaw, verify and dispose', async () => {
  const time = clock();
  const inner = fakeTransport(() => failed('rejected'));
  const breaker = new CircuitBreakerTransport(inner, {
    failureThreshold: 1,
    isFailure: (receipt) => !receipt.successful,
    now: time.now,
  });
  const raw = { envelope: { from: 'a@example.com', to: ['b@example.com'] }, content: 'x' };
  await breaker.sendRaw(raw);
  assert.strictEqual(inner.calls[0].operation, 'sendRaw');
  assert.strictEqual(breaker.state, 'open');
  assert.strictEqual((await breaker.sendRaw(raw)).errors[0].code, 'breaker.open');
  await breaker.verify();
  assert.strictEqual(inner.verified, 1);
  await breaker[Symbol.asyncDispose]();
  assert.strictEqual(inner.disposed, 1);
  const plain = { id: 'plain', send: async () => sent('p'), async *sendMany() {} };
  const wrapped = new CircuitBreakerTransport(plain);
  assert.strictEqual((await wrapped.sendRaw(raw)).errors[0].category, 'configuration');
  await wrapped.verify();
  await wrapped[Symbol.asyncDispose]();
  let disposedSync = 0;
  await new CircuitBreakerTransport({ ...plain, [Symbol.dispose]: () => disposedSync++ })[
    Symbol.asyncDispose
  ]();
  assert.strictEqual(disposedSync, 1);
  await assert.rejects(wrapped.sendRaw(raw, { signal: AbortSignal.abort(new Error('no')) }), /no/);
});

test('Breaker: a listener that throws is a warning, and the options are checked', async (t) => {
  const warnings = [];
  t.mock.method(process, 'emitWarning', (text, options) => warnings.push([text, options.code]));
  const breaker = new CircuitBreakerTransport(
    fakeTransport(() => failed('network')),
    {
      failureThreshold: 1,
      onStateChange: () => {
        throw new Error('listener broke');
      },
    },
  );
  const receipt = await breaker.send(message());
  assert.strictEqual(receipt.errors[0].category, 'network');
  assert.deepStrictEqual(warnings, [
    [
      'The onStateChange of CircuitBreakerTransport threw: listener broke',
      'MAILER_BREAKER_LISTENER_FAILED',
    ],
  ]);
  const inner = fakeTransport();
  assert.throws(
    () => new CircuitBreakerTransport(inner, { failureThreshold: 0 }),
    /failureThreshold/,
  );
  assert.throws(
    () => new CircuitBreakerTransport(inner, { failureThreshold: 1.5 }),
    /failureThreshold/,
  );
  assert.throws(() => new CircuitBreakerTransport(inner, { resetTimeoutMs: 0 }), /resetTimeoutMs/);
  assert.throws(
    () => new CircuitBreakerTransport(inner, { resetTimeoutMs: Infinity }),
    /resetTimeoutMs/,
  );
  assert.throws(
    () => new CircuitBreakerTransport(inner, { resetTimeoutMs: '1' }),
    /resetTimeoutMs/,
  );
  assert.throws(
    () => new CircuitBreakerTransport(inner, { isFailure: true }),
    /isFailure must be a function/,
  );
  const defaults = new CircuitBreakerTransport(inner);
  assert.strictEqual(defaults.config.failureThreshold, 5);
  assert.strictEqual(defaults.config.resetTimeoutMs, 30_000);
  assert.strictEqual(defaults.id, 'fake');
});

test('Breaker: a probe a batch left before its answer frees its place', async () => {
  // Before: a probe admitted while the wrapped transport read ahead, and left
  // unanswered when the caller stopped reading, kept the circuit probing: it
  // refused every send for good.
  const time = clock();
  const inner = fakeTransport(
    (_message, index) => (index === 0 ? failed('network') : sent(`m${index}`)),
    { readAhead: 1 },
  );
  const breaker = new CircuitBreakerTransport(inner, {
    failureThreshold: 1,
    resetTimeoutMs: 1,
    now: time.now,
  });
  const iterator = breaker
    .sendMany([message('a'), message('b'), message('c')])
    [Symbol.asyncIterator]();
  assert.strictEqual((await iterator.next()).value.successful, false);
  // The circuit is open; once its timeout passes, the next message read is the probe.
  time.advance(1);
  assert.strictEqual((await iterator.next()).value.successful, true);
  await iterator.return();
  assert.strictEqual(breaker.state, 'half-open');
  const receipt = await breaker.send(message('d'));
  assert.strictEqual(receipt.successful, true);
  assert.strictEqual(breaker.state, 'closed');
});
