// Paths of the ported MockTransport (src/mock/) that upstream's suites leave out.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { MockTransport } = require('../../src/mock/index.js');

const message = (subject) =>
  createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject,
    content: { text: 'Hi' },
  });

test('Mock: the default response can be replaced', async () => {
  const transport = new MockTransport({ generateUniqueMessageIds: false });
  transport.setDefaultResponse({ successful: true, messageId: 'fixed' });
  assert.deepStrictEqual(await transport.send(message('a')), {
    successful: true,
    messageId: 'fixed',
  });
});

test('Mock: a random delay is validated and replaces the fixed one', async () => {
  const transport = new MockTransport({ delay: 1000 });
  assert.throws(() => transport.setRandomDelay(5, 1), RangeError);
  assert.throws(() => transport.setRandomDelay(-1, 1), RangeError);
  transport.setRandomDelay(0, 1);
  const started = Date.now();
  await transport.send(message('a'));
  assert.ok(Date.now() - started < 500);
});

test('Mock: the failure rate and the delay are validated', () => {
  const transport = new MockTransport();
  assert.throws(() => transport.setFailureRate(1.5), {
    name: 'RangeError',
    message: 'Failure rate must be between 0.0 and 1.0',
  });
  assert.throws(() => transport.setDelay(-1), {
    name: 'RangeError',
    message: 'Delay must be non-negative',
  });
});

test('Mock: findMessagesBy returns every match', async () => {
  const transport = new MockTransport();
  for (const subject of ['a', 'b', 'a']) await transport.send(message(subject));
  assert.strictEqual(transport.findMessagesBy((sent) => sent.subject === 'a').length, 2);
});

test('Mock: an abort during the delay rejects the send and the batch', async () => {
  const transport = new MockTransport({ delay: 20 });
  const controller = new AbortController();
  const sending = transport.send(message('a'), { signal: controller.signal });
  controller.abort();
  await assert.rejects(sending, { name: 'AbortError' });
  assert.strictEqual(transport.getSentMessagesCount(), 0);

  const batch = transport.sendMany([message('a')], { signal: AbortSignal.abort() });
  await assert.rejects(batch[Symbol.asyncIterator]().next(), { name: 'AbortError' });
});

test('Mock: waiting for messages times out', async () => {
  const transport = new MockTransport();
  await assert.rejects(transport.waitForMessageCount(1, 20), {
    message: 'Timeout waiting for 1 messages (got 0)',
  });
  await assert.rejects(
    transport.waitForMessage(() => true, 20),
    { message: 'Timeout waiting for message' },
  );
});

test('Mock: an abort ends the configured delay, with the reason of the signal', async () => {
  const transport = new MockTransport({ delay: 5000 });
  const controller = new AbortController();
  const reason = new Error('Stop.');
  const started = performance.now();
  const sending = transport.send(message('Hello'), { signal: controller.signal });
  setTimeout(() => controller.abort(reason), 20);
  await assert.rejects(sending, (error) => error === reason);
  assert.ok(performance.now() - started < 1000);
  assert.strictEqual(transport.getSentMessagesCount(), 0);
});

test('Mock: random decides the simulated failures', async () => {
  const failing = new MockTransport({ failureRate: 0.5, random: () => 0.1 });
  assert.strictEqual((await failing.send(message('Hi'))).successful, false);
  const passing = new MockTransport({ failureRate: 0.5, random: () => 0.9 });
  assert.strictEqual((await passing.send(message('Hi'))).successful, true);
});
