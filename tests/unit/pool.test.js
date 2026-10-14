// Paths of the ported PoolTransport (src/pool/) that upstream's suites leave
// out: weights that leave nothing to pick, aborts before a send, a timeout
// without a caller signal, and a transport whose dispose throws.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { MockTransport } = require('../../src/mock/index.js');
const { PoolTransport } = require('../../src/pool/index.js');

const message = () =>
  createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Hello',
    content: { text: 'Hi' },
  });

test('Pool: a weighted pool needs an enabled transport with a positive weight', () => {
  assert.throws(
    () =>
      new PoolTransport({
        strategy: 'weighted',
        transports: [{ transport: new MockTransport(), weight: 0 }],
      }),
    { message: 'Weighted strategy requires at least one enabled transport with positive weight' },
  );
});

test('Pool: an aborted signal rejects a send and a batch before any transport', async () => {
  const mock = new MockTransport();
  const pool = new PoolTransport({ strategy: 'round-robin', transports: [{ transport: mock }] });
  const signal = AbortSignal.abort();
  await assert.rejects(pool.send(message(), { signal }), { name: 'AbortError' });
  await assert.rejects(pool.sendMany([message()], { signal })[Symbol.asyncIterator]().next(), {
    name: 'AbortError',
  });
  assert.strictEqual(mock.getSentMessagesCount(), 0);
});

test('Pool: a timeout applies without a caller signal, and retries stop at the last transport', async () => {
  const failing = new MockTransport({
    defaultResponse: { successful: false, errorMessages: ['Down'] },
  });
  const pool = new PoolTransport({
    strategy: 'priority',
    transports: [{ transport: failing }],
    timeout: 1000,
    maxRetries: 3,
  });
  const receipt = await pool.send(message());
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(failing.getSentMessagesCount(), 1);
});

test('Pool: a transport whose dispose throws does not fail the disposal', async () => {
  const throwing = {
    id: 'sync',
    send: async () => ({ successful: true, messageId: 'x' }),
    async *sendMany() {},
    [Symbol.dispose]() {
      throw new Error('dispose failed');
    },
  };
  const pool = new PoolTransport({
    strategy: 'round-robin',
    transports: [{ transport: throwing }],
  });
  await pool[Symbol.asyncDispose]();
});
