// Paths of the ported RetryTransport (src/retry/) that upstream's suites
// leave out: the default wait, the validation of the options, and receipts
// without a retryable flag.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { RetryTransport, createRetryTransport } = require('../../src/retry/index.js');

const message = () =>
  createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Hello',
    content: { text: 'Hi' },
  });
const sequence = (...results) => {
  let calls = 0;
  return {
    id: 'base',
    get calls() {
      return calls;
    },
    send: async () => results[Math.min(calls++, results.length - 1)],
    async *sendMany() {},
  };
};
const failure = (retryable) => ({
  successful: false,
  errorMessages: ['Busy'],
  errors: [{ message: 'Busy', category: 'server-error', code: 'busy', retryable }],
});
const success = { successful: true, messageId: 'ok' };

test('Retry: the options are validated', () => {
  const base = sequence(success);
  assert.throws(() => createRetryTransport(base, { maxAttempts: 0 }), {
    name: 'RangeError',
    message: 'maxAttempts must be an integer greater than or equal to 1.',
  });
  assert.throws(() => createRetryTransport(base, { backoff: { factor: 0.5 } }), {
    name: 'RangeError',
    message: 'backoff.factor must be greater than or equal to 1.',
  });
  assert.ok(new RetryTransport(base) instanceof RetryTransport);
});

test('Retry: the default wait sleeps between attempts and stops on an abort', async () => {
  const base = sequence(failure(true), success);
  const options = { maxAttempts: 2, backoff: { baseDelayMilliseconds: 10 }, jitter: 'none' };
  const receipt = await createRetryTransport(base, options).send(message());
  assert.strictEqual(receipt.successful, true);
  assert.strictEqual(base.calls, 2);

  const controller = new AbortController();
  const slow = { ...options, backoff: { baseDelayMilliseconds: 5000 } };
  const sending = createRetryTransport(sequence(failure(true)), slow).send(message(), {
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(sending, { name: 'AbortError' });
});

test('Retry: a receipt without a retryable flag is retried by its errors', async () => {
  const unflagged = failure(true);
  const base = sequence(unflagged, success);
  const receipt = await createRetryTransport(base, {
    maxAttempts: 2,
    wait: async () => {},
  }).send(message());
  assert.strictEqual(receipt.successful, true);

  const custom = sequence(failure(false), success);
  const forced = await createRetryTransport(custom, {
    maxAttempts: 2,
    wait: async () => {},
    shouldRetry: ({ kind }) => kind === 'receipt',
  }).send(message());
  assert.strictEqual(forced.successful, true);
  assert.strictEqual(custom.calls, 2);

  const final = await createRetryTransport(sequence(failure(true)), {
    maxAttempts: 1,
  }).send(message());
  assert.strictEqual(final.retryable, true);
  assert.strictEqual(final.attempts, 1);
});

test('Retry: the default wait rejects with an AbortError for a signal without a reason', async () => {
  const { createRetryConfig } = require('../../src/retry/config.js');
  const { wait } = createRetryConfig();
  const signal = {
    aborted: true,
    reason: undefined,
    throwIfAborted() {},
    addEventListener() {},
    removeEventListener() {},
  };
  await assert.rejects(wait({ delayMilliseconds: 10 }, signal), { name: 'AbortError' });
});

const unknownDelivery = {
  successful: false,
  errorMessages: ['Timed out after the request was sent'],
  errors: [{ message: 'Timed out', category: 'timeout', code: 'timeout', retryable: true }],
  deliveryUnknown: true,
};

test('Retry: a receipt of unknown delivery is not retried, unless shouldRetry says so', async () => {
  const base = sequence(unknownDelivery, { successful: true, messageId: 'm1' });
  const receipt = await new RetryTransport(base, { maxAttempts: 3 }).send(message());
  assert.strictEqual(base.calls, 1);
  assert.strictEqual(receipt.retryable, false);
  assert.strictEqual(receipt.deliveryUnknown, true);

  const opted = sequence(unknownDelivery, { successful: true, messageId: 'm1' });
  const transport = new RetryTransport(opted, {
    maxAttempts: 3,
    shouldRetry: () => true,
    wait: async () => {},
  });
  assert.strictEqual((await transport.send(message())).successful, true);
  assert.strictEqual(opted.calls, 2);
});

test('Retry: every attempt sends the same Message-ID, without changing the message', async () => {
  const ids = [];
  const base = {
    id: 'base',
    send: async (sent) => {
      ids.push(sent.messageId);
      return ids.length < 3 ? failure(true) : { successful: true, messageId: 'm1' };
    },
    async *sendMany() {},
  };
  const original = message();
  await new RetryTransport(base, { maxAttempts: 3, wait: async () => {} }).send(original);
  assert.strictEqual(ids.length, 3);
  assert.match(ids[0], /^[0-9a-f-]+@example\.com$/);
  assert.deepStrictEqual(new Set(ids).size, 1);
  assert.strictEqual(original.messageId, undefined);
  const own = createMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    content: {},
    messageId: 'own@example.com',
  });
  ids.length = 2;
  await new RetryTransport(base, { maxAttempts: 1 }).send(own);
  assert.strictEqual(ids[2], 'own@example.com');
});
