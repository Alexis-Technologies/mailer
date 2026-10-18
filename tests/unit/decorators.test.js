// Not ported: the decorators of 1.1 composed with ./pool, as the docs suggest.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { CircuitBreakerTransport } = require('../../src/breaker/index.js');
const { HooksTransport } = require('../../src/hooks/index.js');
const { IdempotencyTransport } = require('../../src/idempotency/index.js');
const { PoolTransport } = require('../../src/pool/index.js');
const { PostmarkTransport } = require('../../src/postmark/index.js');
const { RetryTransport } = require('../../src/retry/index.js');
const { failed, fakeTransport, sent } = require('../helpers/decorators/fake.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const message = (fields = {}) =>
  createMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 'Hello',
    content: { text: 'x' },
    ...fields,
  });

test('Decorators: an open circuit takes its provider out of a pool', async () => {
  const down = fakeTransport(() => failed('network'));
  down.id = 'down';
  const up = fakeTransport((_m, index) => sent(`up${index}`));
  up.id = 'up';
  const pool = new PoolTransport({
    transports: [
      { transport: new CircuitBreakerTransport(down, { failureThreshold: 2 }), priority: 2 },
      { transport: up, priority: 1 },
    ],
    strategy: 'priority',
  });
  for (let i = 0; i < 4; i++) assert.strictEqual((await pool.send(message())).successful, true);
  // Two failures opened the circuit; the next sends went straight to the other.
  assert.strictEqual(down.calls.length, 2);
  assert.strictEqual(up.calls.length, 4);
});

test('Decorators: idempotency outside a pool reserves a message once for all its attempts', async () => {
  const flaky = fakeTransport(() => failed('server-error'));
  flaky.id = 'flaky';
  const steady = fakeTransport((_m, index) => sent(`s${index}`));
  steady.id = 'steady';
  const heard = [];
  const transport = new IdempotencyTransport(
    new HooksTransport(
      new PoolTransport({
        transports: [
          { transport: flaky, priority: 2 },
          { transport: steady, priority: 1 },
        ],
        strategy: 'priority',
      }),
      { afterSend: (receipt) => heard.push(receipt.messageId) },
    ),
  );
  const first = await transport.send(message({ idempotencyKey: 'order-1' }));
  const again = await transport.send(message({ idempotencyKey: 'order-1' }));
  assert.strictEqual(first.messageId, 's0');
  assert.deepStrictEqual(again, first);
  assert.strictEqual(flaky.calls.length, 1);
  assert.strictEqual(steady.calls.length, 1);
  assert.deepStrictEqual(heard, ['s0']);
});

const postmark = () => new PostmarkTransport({ serverToken: 'server-token', retries: 0 });

test('Decorators: a pool fails over from a transport that cannot send the message as it is', async (t) => {
  const requests = stubFetch(t, () => json({ MessageID: 'pm1', ErrorCode: 0 }));
  const other = fakeTransport((_m, index) => sent(`other${index}`));
  other.id = 'other';
  const pool = new PoolTransport({
    strategy: 'priority',
    transports: [
      { transport: postmark(), priority: 2 },
      { transport: other, priority: 1 },
    ],
  });
  // Postmark cannot schedule a message nor take two tags: the other sends both.
  const scheduled = await pool.send(message({ scheduledAt: new Date(Date.now() + 3600_000) }));
  const tagged = await pool.send(message({ tags: ['welcome', 'onboarding'] }));
  assert.deepStrictEqual(
    [scheduled.successful, scheduled.messageId, tagged.successful, tagged.messageId],
    [true, 'other0', true, 'other1'],
  );
  assert.strictEqual(other.calls.length, 2);
  assert.strictEqual(requests.length, 0);
  // A message Postmark can send goes through it.
  assert.strictEqual((await pool.send(message())).messageId, 'pm1');

  // When every transport refuses it so, the receipt is unsupported, not retried.
  const refusing = new PoolTransport({
    strategy: 'priority',
    transports: [
      { transport: postmark(), priority: 2 },
      { transport: postmark(), priority: 1 },
    ],
  });
  const refused = await refusing.send(message({ tags: ['welcome', 'onboarding'] }));
  assert.strictEqual(refused.successful, false);
  assert.strictEqual(refused.retryable, false);
  assert.strictEqual(refused.attempts, 2);
  assert.deepStrictEqual(
    refused.errors.map((error) => [error.provider, error.category, error.retryable]),
    [
      ['postmark', 'unsupported', false],
      ['postmark', 'unsupported', false],
    ],
  );
  assert.strictEqual(requests.length, 1);
});

test('Decorators: retry does not retry an unsupported message, nor does a breaker count it', async (t) => {
  const requests = stubFetch(t, () => json({ MessageID: 'pm1', ErrorCode: 0 }));
  const inner = postmark();
  let attempts = 0;
  const counted = {
    id: 'postmark',
    send: (sentMessage, options) => {
      attempts++;
      return inner.send(sentMessage, options);
    },
    async *sendMany() {},
  };
  const retry = new RetryTransport(counted, { maxAttempts: 3, initialDelay: 1 });
  const receipt = await retry.send(message({ tags: ['welcome', 'onboarding'] }));
  assert.strictEqual(receipt.errors[0].category, 'unsupported');
  assert.strictEqual(attempts, 1);

  const breaker = new CircuitBreakerTransport(postmark(), { failureThreshold: 1 });
  const refused = await breaker.send(message({ scheduledAt: new Date(Date.now() + 3600_000) }));
  assert.strictEqual(refused.errors[0].category, 'unsupported');
  assert.strictEqual(breaker.state, 'closed');
  assert.strictEqual((await breaker.send(message())).successful, true);
  assert.strictEqual(requests.length, 1);
});

test('Decorators: a logger hears the breaker, the rate limit, idempotency and the tee', async () => {
  // Before: they took no logger; a circuit that opened or a limit that
  // refused told nothing but a receipt.
  const { RateLimitTransport } = require('../../src/ratelimit/index.js');
  const { TeeTransport } = require('../../src/tee/index.js');
  const records = [];
  const logger = {};
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (fields) => records.push([level, fields.code, fields.decorator]);
  }
  const mail = (fields = {}) =>
    createMessage({
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 's',
      content: { text: 'x' },
      ...fields,
    });
  const breaker = new CircuitBreakerTransport(
    fakeTransport(() => failed('network')),
    {
      failureThreshold: 1,
      logger,
    },
  );
  await breaker.send(mail());
  await breaker.send(mail());
  const limit = new RateLimitTransport(fakeTransport(), { limit: 1, mode: 'reject', logger });
  await limit.send(mail());
  await limit.send(mail());
  const idempotent = new IdempotencyTransport(fakeTransport(), { logger });
  await idempotent.send(mail({ idempotencyKey: 'k' }));
  await idempotent.send(mail({ idempotencyKey: 'k' }));
  await idempotent.send(mail({ idempotencyKey: 'k', subject: 'other' }));
  const tee = new TeeTransport(fakeTransport(), {
    mirrors: [fakeTransport(() => failed('server-error'))],
    awaitMirrors: true,
    logger,
  });
  await tee.send(mail());
  assert.deepStrictEqual(records, [
    ['warn', 'breaker.open', 'breaker'],
    ['debug', 'breaker.open', 'breaker'],
    ['info', 'ratelimit.limited', 'ratelimit'],
    ['debug', 'idempotency.hit', 'idempotency'],
    ['warn', 'idempotency.key_reused', 'idempotency'],
    ['warn', 'MAILER_TEE_MIRROR_FAILED', 'tee'],
  ]);
});

test('Decorators: a jump of the time of day moves no interval of a default clock', async (t) => {
  // Before: ratelimit, the memory stores of idempotency and of the webhooks
  // measured on Date.now, so a correction of the system time refilled a
  // bucket, or ended a lease, early.
  let shift = 0;
  const realNow = Date.now.bind(Date);
  t.mock.method(Date, 'now', () => realNow() + shift);
  const { RateLimitTransport } = require('../../src/ratelimit/index.js');
  const { createMemoryIdempotencyStore } = require('../../src/idempotency/index.js');
  const { createMemoryReplayStore } = require('../../src/webhooks/index.js');
  const limiter = new RateLimitTransport(fakeTransport(), {
    limit: 1,
    intervalMs: 3_600_000,
    mode: 'reject',
  });
  const one = message();
  assert.strictEqual((await limiter.send(one)).successful, true);
  const idempotency = createMemoryIdempotencyStore();
  const reserved = await idempotency.reserve('k', 'f', 60_000);
  const replay = createMemoryReplayStore();
  assert.strictEqual(replay.reserve('r', 60_000, 't'), 'reserved');
  shift = 2 * 3_600_000;
  assert.strictEqual((await limiter.send(one)).successful, false);
  assert.ok((await idempotency.reserve('k', 'f', 60_000)).record !== undefined);
  assert.ok(reserved.token !== undefined);
  assert.strictEqual(replay.reserve('r', 60_000, 'u'), 'pending');
});
