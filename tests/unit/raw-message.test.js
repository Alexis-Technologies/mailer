// Ported from upyo v0.7.0 (packages/core/src/raw-message.test.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  analyzeRawMessage,
  createRawMessagePlan,
  iterateRawMessage,
  RawMessageValidationError,
} = require('../../src/core/raw-message.js');
const { isRawTransport } = require('../../src/core/transport.js');

const bytes = (s) => new TextEncoder().encode(s);
const envelope = { from: 'a@example.com', to: ['b@example.com'] };
const message = (text) => ({
  envelope,
  content: bytes(text),
});
const collect = async (plan) => {
  const result = [];
  for await (const chunk of iterateRawMessage(plan)) result.push(...chunk);
  return new Uint8Array(result);
};

test('raw capability guard preserves the provider type', () => {
  const transport = {
    id: 'test',
    send: () => Promise.resolve({ successful: true, provider: 'test', messageId: 'x' }),
    async *sendMany() {},
  };
  assert.ok(!isRawTransport(transport));
  const raw = { ...transport, sendRaw: transport.send };
  assert.ok(isRawTransport(raw));
});

test('raw analysis accepts headers-only and preserves every chunk boundary', async () => {
  const content = bytes('Subject: hello\r\n\r\n.body\r\n');
  for (let split = 0; split <= content.length; split++) {
    const plan = createRawMessagePlan({
      envelope,
      content: async function* () {
        yield content.subarray(0, split);
        yield content.subarray(split);
      },
    });
    assert.deepEqual(await analyzeRawMessage(plan), {
      size: content.length,
      encoding: '7bit',
    });
    assert.deepEqual(await collect(plan), content);
  }
  assert.deepEqual(
    await collect(createRawMessagePlan(message('Subject: x\r\n'))),
    bytes('Subject: x\r\n'),
  );
});

test('raw validation rejects invalid lines with locations', async () => {
  for (const input of [
    '',
    '\r\n',
    'X: y\n',
    'X: y\r',
    'X: y',
    'X: \0\r\n',
    'X:' + 'x'.repeat(997) + '\r\n',
  ]) {
    await assert.rejects(collect(createRawMessagePlan(message(input))), (error) => {
      assert.ok(error instanceof RawMessageValidationError);
      assert.equal(error.field, 'content');
      assert.equal(typeof error.byteOffset, 'number');
      assert.equal(typeof error.lineNumber, 'number');
      return true;
    });
  }
  await collect(createRawMessagePlan(message('X:' + 'x'.repeat(996) + '\r\n')));
});

test('raw encoding is conservative and declared 7bit is enforced', async () => {
  const raw = message('X: y\r\n\r\nó\r\n');
  assert.equal((await analyzeRawMessage(createRawMessagePlan(raw))).encoding, 'utf8');
  await assert.rejects(
    collect(createRawMessagePlan({ ...raw, encoding: '7bit' })),
    RawMessageValidationError,
  );
  await collect(createRawMessagePlan({ ...raw, encoding: '8bit' }));
});

test('raw plans copy envelopes and observe rejected content before validation', async () => {
  const recipients = ['b@example.com'];
  const plan = createRawMessagePlan({
    ...message('X: y\r\n'),
    envelope: { from: null, to: recipients },
  });
  recipients.length = 0;
  assert.deepEqual(plan.envelope.to, ['b@example.com']);
  assert.throws(
    () =>
      createRawMessagePlan({
        envelope: { from: null, to: [] },
        content: Promise.reject(new TypeError('source')),
      }),
    RawMessageValidationError,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test('raw sources support all replayable kinds and one or two traversals', async () => {
  const content = bytes('X: y\r\n');
  for (const source of [content, Promise.resolve(content), new Blob([content])]) {
    const plan = createRawMessagePlan({ envelope, content: source });
    assert.deepEqual(await collect(plan), content);
    assert.deepEqual(await collect(plan), content);
  }
  let opens = 0;
  const plan = createRawMessagePlan({
    envelope,
    encoding: '7bit',
    content: async function* () {
      opens++;
      yield content;
    },
  });
  await collect(plan);
  assert.equal(opens, 1);
  await analyzeRawMessage(plan);
  await collect(plan);
  assert.equal(opens, 3);
});

test('second traversal revalidates structure and known length', async () => {
  let opens = 0;
  const plan = createRawMessagePlan({
    envelope,
    content: async function* () {
      yield bytes(opens++ === 0 ? 'X: y\r\n' : 'X: y\n\n');
    },
  });
  const info = await analyzeRawMessage(plan);
  await assert.rejects(async () => {
    // oxlint-disable-next-line no-unused-vars -- upstream: the chunks are consumed, not read
    for await (const _ of iterateRawMessage(plan, { expectedSize: info.size })) {
      /* consume */
    }
  }, RawMessageValidationError);
  await assert.rejects(async () => {
    // oxlint-disable-next-line no-unused-vars -- upstream: the chunks are consumed, not read
    for await (const _ of iterateRawMessage(createRawMessagePlan(message('X: y\r\n')), {
      expectedSize: 99,
    })) {
      /* consume */
    }
  }, RawMessageValidationError);
});

test('raw cancellation closes a pending producer once and preserves its reason', async () => {
  let closed = 0;
  let started;
  const ready = new Promise((resolve) => (started = resolve));
  const controller = new AbortController();
  const reason = new TypeError('stop');
  const plan = createRawMessagePlan({
    envelope,
    content: () => ({
      [Symbol.asyncIterator]() {
        return {
          next() {
            started();
            return new Promise(() => {});
          },
          return() {
            closed++;
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    }),
  });
  const reading = analyzeRawMessage(plan, controller.signal);
  await ready;
  controller.abort(reason);
  await assert.rejects(reading, (e) => e === reason);
  assert.equal(closed, 1);
});

test('raw cancellation at final progress rejects instead of reporting EOF', async () => {
  const controller = new AbortController();
  const reason = new TypeError('stop at last byte');
  await assert.rejects(
    analyzeRawMessage(createRawMessagePlan(message('X: y\r\n')), controller.signal, () =>
      controller.abort(reason),
    ),
    (error) => error === reason,
  );
});

test('raw analysis retains validated explicit encoding requirements', async () => {
  const plan = createRawMessagePlan({
    ...message('X: y\r\n\r\nó\r\n'),
    encoding: '8bit',
  });
  assert.equal((await analyzeRawMessage(plan)).encoding, '8bit');
});
