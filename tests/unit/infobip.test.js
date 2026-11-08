// Not ported: tests of ./infobip against a stubbed fetch, the cases of
// thinwrap's spec of its Infobip connector (the body of /sms/3/messages, the
// `App` key, a status of the group REJECTED in a 200, the host of the
// account) rewritten for this transport, and those of its bugs.
const { test } = require('node:test');
const assert = require('node:assert');
const { createChannelMessage } = require('../../src/channels/index.js');
const { InfobipTransport } = require('../../src/infobip/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const NOW = Date.parse('2026-11-08T10:00:00Z');
const transport = (config = {}) =>
  new InfobipTransport({
    apiKey: 'infobip-api-key-123',
    baseUrl: 'abc123.api.infobip.com',
    from: 'InfoSMS',
    retries: 0,
    now: () => NOW,
    ...config,
  });
const sms = (fields = {}) =>
  createChannelMessage({
    channel: 'sms',
    to: '+15559876543',
    text: 'Hello from Infobip!',
    ...fields,
  });
const answer = (status, fields = {}) =>
  json({
    bulkId: 'bulk-1',
    messages: [
      {
        messageId: 'infobip-msg-123',
        status,
        destination: '15559876543',
        details: { messageCount: 1 },
        ...fields,
      },
    ],
  });
const PENDING = { groupId: 1, groupName: 'PENDING', id: 26, name: 'PENDING_ACCEPTED' };
const rejected = (id, name) => ({
  groupId: 5,
  groupName: 'REJECTED',
  id,
  name,
  description: `${name} described`,
});

test('Infobip: an SMS is the body of /sms/3/messages with the App key', async (t) => {
  const requests = stubFetch(t, () => answer(PENDING));
  const receipt = await transport().send(sms());
  const [request] = requests;
  assert.strictEqual(request.url, 'https://abc123.api.infobip.com/sms/3/messages');
  assert.strictEqual(request.method, 'POST');
  assert.strictEqual(request.headers.get('authorization'), 'App infobip-api-key-123');
  assert.strictEqual(request.headers.get('content-type'), 'application/json');
  assert.strictEqual(request.redirect, 'manual');
  assert.deepStrictEqual(request.json, {
    messages: [
      {
        destinations: [{ to: '15559876543' }],
        content: { text: 'Hello from Infobip!' },
        sender: 'InfoSMS',
      },
    ],
    options: { includeSmsCountInResponse: true },
  });
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: 'infobip-msg-123',
    provider: 'infobip',
    channel: 'sms',
    state: 'accepted',
    segments: 1,
  });
});

test('Infobip: the sender, the validity, the delivery reports and the payload', async (t) => {
  const requests = stubFetch(t, () => answer(PENDING, { details: undefined }));
  const receipt = await transport({ notifyUrl: 'https://example.com/infobip/dlr' }).send(
    sms({
      from: 'Other',
      text: 'x'.repeat(200),
      expiresAt: new Date(NOW + 10 * 60_000 + 59_000),
      metadata: { correlationId: 'order-42' },
      payload: {
        content: { transliteration: 'CYRILLIC' },
        options: { platform: { entityId: 'e-1' } },
        webhooks: { delivery: { url: 'https://example.com/other', intermediateReport: true } },
      },
    }),
  );
  assert.deepStrictEqual(requests[0].json.messages[0], {
    destinations: [{ to: '15559876543' }],
    content: { text: 'x'.repeat(200), transliteration: 'CYRILLIC' },
    sender: 'Other',
    options: {
      validityPeriod: { amount: 10, timeUnit: 'MINUTES' },
      platform: { entityId: 'e-1' },
    },
    webhooks: {
      delivery: { url: 'https://example.com/other', intermediateReport: true },
      contentType: 'application/json',
      callbackData: 'order-42',
    },
  });
  assert.strictEqual(receipt.segments, 2, 'counted here when Infobip gives no messageCount');
  await transport({ from: undefined }).send(sms({ expiresAt: new Date(NOW + 1000) }));
  assert.strictEqual(requests[1].json.messages[0].sender, undefined, 'the default of the account');
  assert.deepStrictEqual(requests[1].json.messages[0].options.validityPeriod.amount, 1);
  await transport().send(sms({ expiresAt: new Date(NOW + 30 * 86_400_000) }));
  assert.strictEqual(requests[2].json.messages[0].options.validityPeriod.amount, 2880);
});

test('Infobip: a status of the group REJECTED in a 200 is a refusal by its name', async (t) => {
  // Before (NV4): Novu's provider took the messageId of any 200, so a message
  // Infobip refused was reported sent.
  const cases = [
    [rejected(52, 'REJECTED_DESTINATION'), 'invalid-recipient', false],
    [rejected(9, 'REJECTED_PREFIX_MISSING'), 'invalid-recipient', false],
    [rejected(15, 'REJECTED_DND'), 'opted-out', false],
    [rejected(7, 'REJECTED_NOT_ENOUGH_CREDITS'), 'configuration', false],
    [rejected(6, 'REJECTED_SENDER'), 'configuration', false],
    [rejected(18, 'REJECTED_DESTINATION_NOT_REGISTERED'), 'configuration', false],
    [rejected(87, 'REJECTED_FLOODING_FILTER'), 'rate-limit', true],
    [rejected(25, 'REJECTED_MESSAGE_TOO_LONG'), 'validation', false],
    [rejected(21, 'REJECTED_SYSTEM_ERROR'), 'server-error', true],
    [rejected(99, 'REJECTED_SOMETHING_NEW'), 'rejected', false],
    [{ groupName: 'REJECTED', name: 'REJECTED_DESTINATION' }, 'invalid-recipient', false],
    [
      { groupId: 2, groupName: 'UNDELIVERABLE', name: 'UNDELIVERABLE_REJECTED_OPERATOR' },
      'rejected',
      false,
    ],
    [{ groupId: 5 }, 'rejected', false],
  ];
  for (const [status, category, retryable] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () => answer(status));
    const receipt = await transport().send(sms());
    assert.strictEqual(receipt.successful, false, status.name);
    assert.strictEqual(receipt.errors[0].category, category, status.name);
    assert.strictEqual(receipt.retryable, retryable, status.name);
    assert.strictEqual(receipt.channel, 'sms');
  }
  assert.strictEqual(
    (await transport().send(sms())).errors[0].code,
    'infobip.REJECTED',
    'a status with no name',
  );
  t.mock.restoreAll();
  stubFetch(t, () => answer(rejected(15, 'REJECTED_DND')));
  const refused = await transport().send(sms());
  assert.strictEqual(refused.errors[0].code, 'infobip.REJECTED_DND');
  assert.match(refused.errorMessages[0], /REJECTED_DND described/);
});

test('Infobip: a refused message names no number in its receipt', async (t) => {
  // Before (C25): providerDetails held the answer, whose message names its
  // destination without its +.
  stubFetch(t, () => answer(rejected(15, 'REJECTED_DND')));
  const receipt = await transport().send(sms());
  assert.deepStrictEqual(receipt.errors[0].providerDetails, {
    status: rejected(15, 'REJECTED_DND'),
  });
  assert.ok(!JSON.stringify(receipt).includes('15559876543'));
});

test('Infobip: an error answer is told by its status, its code kept', async (t) => {
  const cases = [
    [json({ errorCode: 'E401', description: 'Invalid login details' }, 401), 'auth', false, 'E401'],
    [
      json({ requestError: { serviceException: { messageId: 'UNAUTHORIZED', text: 'x' } } }, 401),
      'auth',
      false,
      'UNAUTHORIZED',
    ],
    [json({ errorCode: 'E403', description: 'Forbidden' }, 403), 'configuration', false, 'E403'],
    [json({ errorCode: 'E400', description: 'Bad request' }, 400), 'validation', false, 'E400'],
    [json({ errorCode: 'E429' }, 429, { 'retry-after': '1' }), 'rate-limit', true, 'E429'],
    [json({}, 422), 'validation', false, 'http_422'],
  ];
  for (const [response, category, retryable, code] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () => response.clone());
    const receipt = await transport().send(sms());
    assert.strictEqual(receipt.errors[0].category, category, code);
    assert.strictEqual(receipt.retryable, retryable, code);
    assert.strictEqual(receipt.errors[0].code, `infobip.${code}`, code);
  }
  t.mock.restoreAll();
  stubFetch(t, () => json({ errorCode: 'E401', description: 'Invalid login details' }, 401));
  assert.match((await transport().send(sms())).errorMessages[0], /Invalid login details/);
});

test('Infobip: no id is of unknown delivery, and a lost answer is not sent again', async (t) => {
  stubFetch(t, () => json({ messages: [] }));
  const empty = await transport().send(sms());
  assert.strictEqual(empty.deliveryUnknown, true);
  t.mock.restoreAll();
  const requests = stubFetch(t, () => {
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    });
  });
  assert.strictEqual((await transport({ retries: 3 }).send(sms())).deliveryUnknown, true);
  assert.strictEqual(requests.length, 1);
});

test('Infobip: what an SMS cannot be fails before any request', async (t) => {
  const requests = stubFetch(t, () => answer(PENDING));
  const cases = [
    [sms({ text: undefined, payload: {} }), 'validation', /needs a text/],
    [sms({ media: [{ url: 'https://example.com/a.png' }] }), 'unsupported', /no media/],
    [
      sms({ buttons: [{ type: 'url', text: 'x', url: 'https://example.com/' }] }),
      'unsupported',
      /no buttons/,
    ],
    [sms({ payload: { destinations: [] } }), 'validation', /cannot set destinations/],
    [sms({ payload: { content: { text: 'other' } } }), 'validation', /cannot set content.text/],
    [
      createChannelMessage({ channel: 'whatsapp', to: '+15559876543', text: 'x' }),
      'unsupported',
      /not messages of whatsapp/,
    ],
  ];
  for (const [message, category, pattern] of cases) {
    const receipt = await transport().send(message);
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
  }
  assert.strictEqual(requests.length, 0);
});

test('Infobip: the base URL is the host of the account or a URL, never echoed', async (t) => {
  // From thinwrap: a scheme, a path or userinfo in the host could move the
  // key to another host.
  for (const baseUrl of ['evil.example/x', 'user@evil.example', 'a..b', 'host:443', '']) {
    assert.throws(
      () => transport({ baseUrl }),
      (error) => error instanceof TypeError && (baseUrl === '' || !error.message.includes(baseUrl)),
      baseUrl,
    );
  }
  assert.throws(() => transport({ baseUrl: 'http://api.example.com' }), TypeError);
  assert.throws(() => transport({ notifyUrl: 'http://example.com/dlr' }), TypeError);
  assert.throws(() => new InfobipTransport({ baseUrl: 'abc.api.infobip.com' }), /needs apiKey/);
  const requests = stubFetch(t, () => answer(PENDING));
  await transport({ baseUrl: 'https://abc123.api.infobip.com/' }).send(sms());
  assert.strictEqual(requests[0].url, 'https://abc123.api.infobip.com/sms/3/messages');
  assert.ok(!JSON.stringify(transport()).includes('infobip-api-key-123'));
});

test('Infobip: verify reads the balance, a 403 of a scoped key verifies it', async (t) => {
  const requests = stubFetch(t, () => json({ balance: 10.5, currency: 'EUR' }));
  await transport().verify();
  assert.strictEqual(requests[0].url, 'https://abc123.api.infobip.com/account/1/balance');
  assert.strictEqual(requests[0].headers.get('authorization'), 'App infobip-api-key-123');
  t.mock.restoreAll();
  stubFetch(t, () => json({ errorCode: 'E403' }, 403));
  await transport().verify();
  t.mock.restoreAll();
  stubFetch(t, () => json({ errorCode: 'E401' }, 401));
  await assert.rejects(transport().verify(), (error) => error.statusCode === 401);
});
