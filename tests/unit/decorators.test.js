// Not ported: the decorators of 1.1 composed with ./pool, as the docs suggest.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { CircuitBreakerTransport } = require('../../src/breaker/index.js');
const { HooksTransport } = require('../../src/hooks/index.js');
const { IdempotencyTransport } = require('../../src/idempotency/index.js');
const { PoolTransport } = require('../../src/pool/index.js');
const { failed, fakeTransport, sent } = require('../helpers/decorators/fake.js');

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
