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

test('Mock: reset() clears the raw messages too', async () => {
  const transport = new MockTransport();
  const raw = {
    envelope: { from: 'alex@example.com', to: ['bob@example.com'] },
    content: 'Subject: Hi\r\n\r\nHi\r\n',
  };
  await transport.sendRaw(raw);
  assert.strictEqual(transport.getSentRawMessages().length, 1);
  transport.reset();
  assert.deepStrictEqual(transport.getSentRawMessages(), []);
});

test('Mock: the messages of a channel are found by their recipient and their channel', async () => {
  const { createChannelMessage } = require('../../src/channels/index.js');
  const transport = new MockTransport();
  const email = message('Hi');
  const sms = createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'Code 1234' });
  const telegram = createChannelMessage({ channel: 'telegram', to: 42, text: 'Hi' });
  const push = createChannelMessage({ channel: 'push', to: { token: 'device-1' }, text: 'Hi' });
  const webPush = createChannelMessage({
    channel: 'push',
    to: {
      endpoint: 'https://push.example/sub/1',
      keys: {
        p256dh:
          'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
        auth: 'tBHItJI5svbpez7KI4CCXg',
      },
    },
    text: 'Hi',
  });
  const teams = createChannelMessage({
    channel: 'teams',
    to: { serviceUrl: 'https://smba.trafficmanager.net/emea/', conversationId: 'conv-1' },
    text: 'Hi',
  });
  const slack = createChannelMessage({ channel: 'slack', text: 'Hi' });
  for (const sent of [email, sms, telegram, push, webPush, teams, slack]) {
    await transport.send(sent);
  }
  // Before: getMessagesTo read the recipients of email from every message
  // and threw on the first of a channel.
  assert.deepStrictEqual(transport.getMessagesTo('+380671234567'), [sms]);
  assert.deepStrictEqual(transport.getMessagesTo(42), [telegram]);
  assert.deepStrictEqual(transport.getMessagesTo('42'), [telegram]);
  assert.deepStrictEqual(transport.getMessagesTo('device-1'), [push]);
  assert.deepStrictEqual(transport.getMessagesTo('https://push.example/sub/1'), [webPush]);
  assert.deepStrictEqual(transport.getMessagesTo('conv-1'), [teams]);
  assert.deepStrictEqual(transport.getMessagesTo('bob@example.com'), [email]);
  assert.deepStrictEqual(transport.getMessagesTo('undefined'), []);
  assert.deepStrictEqual(transport.getMessagesByChannel('push'), [push, webPush]);
  assert.deepStrictEqual(transport.getMessagesByChannel('email'), [email]);
  // A message of a channel has no subject, which made it match undefined.
  assert.deepStrictEqual(transport.getMessagesBySubject(undefined), []);
  assert.deepStrictEqual(transport.getMessagesBySubject('Hi'), [email]);
  // An email message made by hand, with no channel and no Cc, is email.
  const { channel: _channel, ccRecipients: _cc, ...manual } = email;
  transport.clearSentMessages();
  await transport.send(manual);
  assert.deepStrictEqual(transport.getMessagesTo('bob@example.com'), [manual]);
  assert.deepStrictEqual(transport.getMessagesByChannel('email'), [manual]);
});
