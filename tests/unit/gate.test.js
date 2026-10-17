// Not ported: tests of the gated sendMany the decorators share.
const { test } = require('node:test');
const assert = require('node:assert');
const { Fifo, gatedSendMany } = require('../../src/internal/gate.js');
const { collect, fakeTransport, sent } = require('../helpers/decorators/fake.js');

test('Gate: answers in place keep their order among those of the wrapped transport', async () => {
  const inner = fakeTransport((message) => sent(`sent-${message}`), { readAhead: 2 });
  const receipts = await collect(
    gatedSendMany(inner, [1, 2, 3, 4, 5, 6, 7], undefined, {
      admit: (n) => (n % 3 === 0 ? { receipt: sent(`own-${n}`) } : { message: n }),
    }),
  );
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.messageId),
    ['sent-1', 'sent-2', 'own-3', 'sent-4', 'sent-5', 'own-6', 'sent-7'],
  );
});

test('Gate: a long batch goes through, and a break closes the input', async () => {
  const inner = fakeTransport((message) => sent(String(message)));
  const many = [];
  for (let i = 0; i < 3000; i++) many.push(i);
  let settled = 0;
  const receipts = await collect(
    gatedSendMany(inner, many, undefined, {
      admit: (n) => ({ message: n }),
      settle: (receipt) => {
        settled++;
        return receipt;
      },
    }),
  );
  assert.strictEqual(receipts.length, 3000);
  assert.strictEqual(receipts[2999].messageId, '2999');
  assert.strictEqual(settled, 3000);
  let closed = false;
  const endless = {
    [Symbol.asyncIterator]() {
      let n = 0;
      return {
        next: async () => ({ done: false, value: n++ }),
        return: async () => {
          closed = true;
          return { done: true };
        },
      };
    },
  };
  for await (const receipt of gatedSendMany(inner, endless, undefined, {
    admit: (n) => ({ message: n }),
  })) {
    if (receipt.messageId === '3') break;
  }
  assert.strictEqual(closed, true);
});

test('Gate: the queue keeps its order across its compaction', () => {
  const queue = new Fifo();
  for (let i = 0; i < 5000; i++) queue.push(i);
  for (let i = 0; i < 4000; i++) assert.strictEqual(queue.shift(), i);
  assert.strictEqual(queue.size, 1000);
  queue.push(5000);
  assert.strictEqual(queue.shift(), 4000);
});
