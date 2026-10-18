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

test('Gate: what a transport reading ahead was handed is abandoned on a break', async () => {
  // Before: neither settle nor fail heard of it, so a decorator kept its
  // state for it: a reserved key, a probe, a hook never called.
  const inner = fakeTransport((message) => sent(String(message)), { readAhead: 3 });
  const abandoned = [];
  const gate = {
    admit: (n) => ({ message: n }),
    settle: (receipt) => receipt,
    abandon: (admitted) => {
      abandoned.push(admitted.message);
    },
  };
  for await (const receipt of gatedSendMany(inner, [1, 2, 3, 4, 5, 6], undefined, gate)) {
    if (receipt.messageId === '1') break;
  }
  assert.deepStrictEqual(abandoned, [2, 3, 4]);
  // A transport that answers fewer messages than it read abandons the rest.
  const short = {
    async *sendMany(messages) {
      for await (const message of messages) {
        if (message === 2) return;
        // Never reached: the transport ends before it answers anything.
        if (message === 0) yield sent('none');
      }
    },
  };
  abandoned.length = 0;
  assert.deepStrictEqual(await collect(gatedSendMany(short, [1, 2], undefined, gate)), []);
  assert.deepStrictEqual(abandoned, [1, 2]);
});

test('Gate: a message the wrapped sendMany never took is told unsent, or failed', async () => {
  // Before: the first message of a run was admitted before the wrapped
  // sendMany() took it, and its slot made only once taken, so a sendMany()
  // that threw or returned at once left it neither failed nor abandoned.
  const told = [];
  const gate = {
    admit: (n) => ({ message: n }),
    fail: (error, admitted) => {
      told.push(['fail', admitted.message, error.message]);
    },
    abandon: (admitted) => {
      told.push(['abandon', admitted.message]);
    },
  };
  const throwing = {
    // oxlint-disable-next-line require-yield -- it throws before any message
    async *sendMany() {
      throw new Error('down');
    },
  };
  const empty = {
    async *sendMany() {},
  };
  await assert.rejects(collect(gatedSendMany(throwing, [1, 2], undefined, gate)), /down/);
  assert.deepStrictEqual(await collect(gatedSendMany(empty, [3], undefined, gate)), []);
  assert.deepStrictEqual(told, [
    ['fail', 1, 'down'],
    ['abandon', 3],
  ]);
  // A gate with unsent hears of them there: they were not sent.
  told.length = 0;
  const unsentGate = { ...gate, unsent: (admitted) => told.push(['unsent', admitted.message]) };
  await assert.rejects(collect(gatedSendMany(throwing, [1], undefined, unsentGate)), /down/);
  assert.deepStrictEqual(await collect(gatedSendMany(empty, [3], undefined, unsentGate)), []);
  assert.deepStrictEqual(told, [
    ['unsent', 1],
    ['unsent', 3],
  ]);
});

test('Gate: answers in place do not split the batch of the wrapped transport', async () => {
  // Before: each answer in place ended the run, so a batching transport got
  // batches of the messages between two of them.
  let calls = 0;
  const batching = {
    async *sendMany(messages) {
      calls++;
      for await (const message of messages) yield sent(String(message));
    },
  };
  const many = [];
  for (let i = 1; i <= 100; i++) many.push(i);
  const receipts = await collect(
    gatedSendMany(batching, many, undefined, {
      admit: (n) => (n % 10 === 0 ? { receipt: sent(`own-${n}`) } : { message: n }),
    }),
  );
  assert.strictEqual(calls, 1);
  assert.strictEqual(receipts.length, 100);
  assert.strictEqual(receipts[9].messageId, 'own-10');
  assert.strictEqual(receipts[10].messageId, '11');
  // A streak of answers in place past the bound ends the run, and the input
  // is not read ahead without end.
  calls = 0;
  let read = 0;
  const endless = {
    [Symbol.asyncIterator]() {
      return { next: async () => ({ done: false, value: read++ }) };
    },
  };
  for await (const receipt of gatedSendMany(batching, endless, undefined, {
    admit: (n) => (n === 0 ? { message: n } : { receipt: sent(`own-${n}`) }),
  })) {
    if (receipt.messageId === 'own-70') break;
  }
  assert.ok(read < 200, String(read));
});
