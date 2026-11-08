// Not ported: tests of ./router, a transport that sends each message through
// the transport of its channel.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage, createRawMessagePlan } = require('../../src/index.js');
const { createChannelMessage } = require('../../src/channels/index.js');
const { RouterTransport, createRouter } = require('../../src/router/index.js');
const { collect, fakeTransport, sent } = require('../helpers/decorators/fake.js');

const email = (subject = 'Hi') =>
  createMessage({ from: 'a@example.com', to: 'b@example.com', subject, content: { text: 't' } });
const sms = (text = 'Code') => createChannelMessage({ channel: 'sms', to: '+380671234567', text });
const telegram = () => createChannelMessage({ channel: 'telegram', to: 42, text: 'Hi' });

// A transport whose receipts name it and what it was given.
const route = (id, extras) => {
  const transport = fakeTransport(
    (message) => sent(`${id}:${message.subject ?? message.text}`),
    extras,
  );
  return Object.assign(transport, { id });
};

test('Router: a message goes through the transport of its channel', async () => {
  const routes = { email: route('ses'), sms: route('twilio') };
  const router = createRouter(routes);
  assert.ok(router instanceof RouterTransport);
  assert.strictEqual(router.id, 'router');
  assert.strictEqual((await router.send(email('Welcome'))).messageId, 'ses:Welcome');
  assert.strictEqual((await router.send(sms('Code 1'))).messageId, 'twilio:Code 1');
  // A message of 1.x, without a channel, is email.
  const { channel: _channel, ...unchanneled } = email('Old');
  assert.strictEqual((await router.send(unchanneled)).messageId, 'ses:Old');
  assert.strictEqual(routes.email.calls.length, 2);
  assert.strictEqual(routes.sms.calls.length, 1);
});

test('Router: a message of a channel without a route fails as unsupported', async () => {
  const router = createRouter({ email: route('ses') });
  const receipt = await router.send(telegram());
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.retryable, false);
  assert.strictEqual(receipt.channel, 'telegram');
  assert.strictEqual(receipt.errors[0].category, 'unsupported');
  assert.strictEqual(receipt.provider, 'router');
});

test('Router: sendMany gives the messages of a channel in a row to its batch, in order', async () => {
  const routes = { email: route('ses', { readAhead: 2 }), sms: route('twilio') };
  const router = createRouter(routes);
  const receipts = await collect(
    router.sendMany([email('1'), email('2'), sms('3'), telegram(), email('4'), sms('5')]),
  );
  const ids = [];
  for (const receipt of receipts) ids.push(receipt.messageId ?? receipt.channel);
  assert.deepStrictEqual(ids, ['ses:1', 'ses:2', 'twilio:3', 'telegram', 'ses:4', 'twilio:5']);
  const operations = [];
  for (const call of routes.email.calls) operations.push(call.operation);
  assert.deepStrictEqual(operations, ['sendMany', 'sendMany', 'sendMany']);
});

test('Router: a message is given once though its transport stops reading', async () => {
  // A transport of SMS that sends the first message of each batch alone.
  const twilio = route('twilio');
  twilio.sendMany = async function* (messages, options) {
    for await (const message of messages) {
      yield await twilio.send(message, options);
      return;
    }
  };
  const router = createRouter({ sms: twilio, email: route('ses') });
  const receipts = await collect(router.sendMany([sms('1'), sms('2'), sms('3'), email('4')]));
  const ids = [];
  for (const receipt of receipts) ids.push(receipt.messageId);
  assert.deepStrictEqual(ids, ['twilio:1', 'twilio:2', 'twilio:3', 'ses:4']);
});

test('Router: a message its transport never takes fails, and the next goes on', async () => {
  // Before (C9): a route whose sendMany ended without reading was given the
  // same message again, without end, in microtasks that starved the loop.
  const idle = route('idle');
  idle.sendMany = async function* () {};
  const router = createRouter({ sms: idle, email: route('ses') });
  const receipts = await collect(router.sendMany([sms('1'), sms('2'), email('3')]));
  assert.strictEqual(receipts.length, 3);
  assert.strictEqual(receipts[0].successful, false);
  assert.strictEqual(receipts[0].errors[0].category, 'unsupported');
  assert.strictEqual(receipts[0].channel, 'sms');
  assert.match(receipts[0].errorMessages[0], /took no message/);
  assert.strictEqual(receipts[1].successful, false);
  assert.strictEqual(receipts[2].messageId, 'ses:3');
});

test('Router: a caller who leaves sendMany closes its input', async () => {
  let closed = false;
  let read = 0;
  const input = (function* () {
    try {
      for (let index = 0; index < 100; index++) {
        read++;
        yield email(String(index));
      }
    } finally {
      closed = true;
    }
  })();
  const router = createRouter({ email: route('ses') });
  for await (const receipt of router.sendMany(input)) {
    assert.strictEqual(receipt.messageId, 'ses:0');
    break;
  }
  assert.ok(closed);
  assert.ok(read <= 2, String(read));
  assert.deepStrictEqual(await collect(createRouter({ email: route('ses') }).sendMany([])), []);
});

test('Router: an abort of the caller is heard before each send and each run', async () => {
  const controller = new AbortController();
  const reason = new Error('stop');
  controller.abort(reason);
  const router = createRouter({ email: route('ses') });
  await assert.rejects(
    router.send(email(), { signal: controller.signal }),
    (error) => error === reason,
  );
  await assert.rejects(
    collect(router.sendMany([email()], { signal: controller.signal })),
    (error) => error === reason,
  );
  await assert.rejects(router.verify({ signal: controller.signal }), (error) => error === reason);
});

test('Router: a raw message goes through the transport of email', async () => {
  const raw = createRawMessagePlan({
    envelope: { from: 'a@example.com', to: ['b@example.com'] },
    content: new TextEncoder().encode('From: a@example.com\r\n\r\nHi\r\n'),
  });
  const ses = route('ses');
  const receipt = await createRouter({ email: ses, sms: route('twilio') }).sendRaw(raw);
  assert.strictEqual(receipt.successful, true);
  assert.strictEqual(ses.calls[0].operation, 'sendRaw');
  const none = await createRouter({ sms: route('twilio') }).sendRaw(raw);
  assert.strictEqual(none.errors[0].category, 'unsupported');
  const composer = route('ses', { overrides: { sendRaw: undefined } });
  const refused = await createRouter({ email: composer }).sendRaw(raw);
  assert.strictEqual(refused.errors[0].category, 'configuration');
});

test('Router: verify checks each transport once, and fails with each that fails', async () => {
  const shared = route('ses');
  const router = createRouter({ email: shared, sms: route('twilio'), push: shared });
  await router.verify();
  assert.strictEqual(shared.verified, 1);
  const broken = route('telegram', {
    overrides: {
      async verify() {
        throw new Error('token revoked');
      },
    },
  });
  const unverifiable = route('slack', { overrides: { verify: undefined } });
  await assert.rejects(
    createRouter({ email: route('ses'), telegram: broken, slack: unverifiable }).verify(),
    (error) => error instanceof AggregateError && error.errors[0].message === 'token revoked',
  );
});

test('Router: a transport whose verify throws at once is one failure among the others', async () => {
  // Before (C10): the call was not wrapped, so the router rejected with that
  // error alone and verified none after it.
  const refusing = route('sms');
  refusing.verify = () => {
    throw new Error('sms refused');
  };
  const chat = route('chat');
  const router = createRouter({ sms: refusing, telegram: chat });
  await assert.rejects(
    router.verify(),
    (error) => error instanceof AggregateError && error.errors[0].message === 'sms refused',
  );
  assert.strictEqual(chat.verified, 1);
});

test('Router: dispose disposes of each transport once, whichever fails', async () => {
  const shared = route('ses');
  const failing = route('twilio', {
    overrides: {
      async [Symbol.asyncDispose]() {
        throw new Error('busy');
      },
    },
  });
  const other = route('telegram');
  const router = createRouter({ email: shared, push: shared, sms: failing, telegram: other });
  await assert.rejects(
    router[Symbol.asyncDispose](),
    (error) => error instanceof AggregateError && error.errors.length === 1,
  );
  assert.strictEqual(shared.disposed, 1);
  assert.strictEqual(other.disposed, 1);
  await createRouter({ email: route('ses') })[Symbol.asyncDispose]();
});

test('Router: its routes are transports of channels', () => {
  for (const routes of [undefined, null, [], {}, { email: undefined }]) {
    assert.throws(() => createRouter(routes), TypeError, JSON.stringify(routes));
  }
  assert.throws(() => createRouter({ fax: route('x') }), /no channel "fax"/);
  assert.throws(() => createRouter({ sms: { send() {} } }), /route of sms/);
});
