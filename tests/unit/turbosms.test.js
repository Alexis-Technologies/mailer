// Not ported: tests of ./turbosms against a stubbed fetch, the answers of
// the examples of TurboSMS's documentation: the request of message/send, its
// sequence_id, a hybrid of Viber and SMS, the codes of an answer and of its
// recipient.
const { test } = require('node:test');
const assert = require('node:assert');
const { createChannelMessage } = require('../../src/channels/index.js');
const { TurboSmsTransport } = require('../../src/turbosms/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const NOW = Date.parse('2026-11-08T10:00:00Z');
const TOKEN = 'TurboSmsTokenSecret0123';
const transport = (config = {}) =>
  new TurboSmsTransport({
    token: TOKEN,
    sender: 'MyBrand',
    retries: 0,
    now: () => NOW,
    generateId: () => '8f2b1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    ...config,
  });
const sms = (fields = {}) =>
  createChannelMessage({ channel: 'sms', to: '+380678998668', text: 'Ваш код 1234', ...fields });
const viber = (fields = {}) =>
  createChannelMessage({ channel: 'viber', to: '+380678998668', text: 'Ваш код 1234', ...fields });
const answer = (code, status, recipient) =>
  json({
    response_code: code,
    response_status: status,
    response_result: recipient === undefined ? null : [{ phone: '380678998668', ...recipient }],
  });
const ok = () =>
  answer(800, 'SUCCESS_MESSAGE_ACCEPTED', {
    response_code: 0,
    message_id: 'f83f8868-5e46-c6cf-e4fb-615e5a293754',
    response_status: 'OK',
  });

test('TurboSMS: an SMS is message/send with the token and a sequence_id', async (t) => {
  const requests = stubFetch(t, () => ok());
  const receipt = await transport().send(sms());
  const [request] = requests;
  assert.strictEqual(request.url, 'https://api.turbosms.ua/message/send.json');
  assert.strictEqual(request.headers.get('authorization'), `Bearer ${TOKEN}`);
  assert.deepStrictEqual(request.json, {
    recipients: ['380678998668'],
    sequence_id: '8f2b1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    sms: { sender: 'MyBrand', text: 'Ваш код 1234' },
  });
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: 'f83f8868-5e46-c6cf-e4fb-615e5a293754',
    provider: 'turbosms',
    channel: 'sms',
    state: 'accepted',
    segments: 1,
  });
});

test('TurboSMS: a message of Viber, and a hybrid with an SMS by the payload', async (t) => {
  const requests = stubFetch(t, () => ok());
  const receipt = await transport({ viberSender: 'MyBrandViber' }).send(
    viber({
      media: [{ url: 'https://example.com/a.png' }],
      buttons: [{ type: 'url', text: 'Track', url: 'https://example.com/t/1' }],
      expiresAt: new Date(NOW + 3_600_000),
      payload: { sms: { text: 'Ваш код 1234' } },
    }),
  );
  assert.deepStrictEqual(requests[0].json, {
    recipients: ['380678998668'],
    sequence_id: '8f2b1c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    viber: {
      sender: 'MyBrandViber',
      text: 'Ваш код 1234',
      image_url: 'https://example.com/a.png',
      caption: 'Track',
      action: 'https://example.com/t/1',
      ttl: 3600,
    },
    sms: { sender: 'MyBrand', text: 'Ваш код 1234' },
  });
  assert.strictEqual(receipt.channel, 'viber');
  assert.strictEqual(receipt.segments, undefined);
  await transport().send(viber({ expiresAt: new Date(NOW + 1000), from: 'Other' }));
  assert.deepStrictEqual(requests[1].json.viber, {
    sender: 'Other',
    text: 'Ваш код 1234',
    ttl: 30,
  });
});

test('TurboSMS: a lost answer is sent again under the sequence_id, answered once', async (t) => {
  const requests = stubFetch(t, (_request, index) => {
    if (index === 0) {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
      });
    }
    return answer(507, 'FAILED_DUPLICATE_REQUEST', {
      response_code: 0,
      message_id: 'f83f8868',
      response_status: 'OK',
    });
  });
  const receipt = await transport({ retries: 1 }).send(sms());
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(requests[0].body, requests[1].body);
  assert.strictEqual(receipt.successful, true, 'the results of the first');
  assert.strictEqual(receipt.messageId, 'f83f8868');
});

test('TurboSMS: the code of the answer, then of its recipient, fails the message', async (t) => {
  const cases = [
    [answer(105, 'REQUIRED_AUTH'), 'auth', false, 105],
    [answer(203, 'REQUIRED_BALANCE'), 'configuration', false, 203],
    [answer(302, 'INVALID_MESSAGE_SENDER'), 'configuration', false, 302],
    [answer(304, 'INVALID_MESSAGE_TEXT'), 'validation', false, 304],
    [answer(9001, 'FATAL_ERROR'), 'rejected', false, 9001],
    [
      answer(802, 'SUCCESS_MESSAGE_PARTIAL_ACCEPTED', {
        response_code: 406,
        message_id: null,
        response_status: 'NOT_ALLOWED_RECIPIENT_COUNTRY',
      }),
      'configuration',
      false,
      406,
    ],
    [
      answer(0, 'x', { response_code: 305, response_status: 'INVALID_PHONE' }),
      'invalid-recipient',
      false,
      305,
    ],
    [
      answer(0, 'x', { response_code: 404, response_status: 'NOT_ALLOWED_NUMBER_STOPLIST' }),
      'opted-out',
      false,
      404,
    ],
    [
      answer(0, 'x', { response_code: 428, response_status: 'NOT_ALLOWED_MESSAGES_NUMBER_LIMIT' }),
      'rate-limit',
      true,
      428,
    ],
  ];
  for (const [response, category, retryable, code] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () => response.clone());
    const receipt = await transport().send(sms());
    assert.strictEqual(receipt.errors[0].category, category, String(code));
    assert.strictEqual(receipt.retryable, retryable, String(code));
    assert.strictEqual(receipt.errors[0].code, `turbosms.${code}`, String(code));
  }
  t.mock.restoreAll();
  stubFetch(t, () => answer(105, 'REQUIRED_AUTH'));
  assert.match((await transport().send(sms())).errorMessages[0], /TurboSMS: REQUIRED_AUTH/);
});

test('TurboSMS: an answer it could not write is asked again under the sequence_id', async (t) => {
  // Before (C14): 500 FAILED_CONVERT_RESULT2JSON, a request that ran and an
  // answer that could not be written, was a retryable failure, which a queue
  // sent again under a new sequence_id: twice.
  const requests = stubFetch(t, (_request, index) =>
    index === 0
      ? answer(500, 'FAILED_CONVERT_RESULT2JSON')
      : answer(507, 'FAILED_DUPLICATE_REQUEST', {
          response_code: 0,
          message_id: 'f83f8868',
          response_status: 'OK',
        }),
  );
  const receipt = await transport({ retries: 1 }).send(sms());
  assert.strictEqual(receipt.successful, true);
  assert.strictEqual(receipt.messageId, 'f83f8868');
  assert.strictEqual(requests[0].body, requests[1].body);
  t.mock.restoreAll();
  stubFetch(t, () => answer(501, 'FAILED_CONVERT_RESULT2XML'));
  const lost = await transport({ retries: 1 }).send(sms());
  assert.strictEqual(lost.deliveryUnknown, true);
  t.mock.restoreAll();
  stubFetch(t, () => answer(502, 'FAILED_PARSE_BODY'));
  const unparsed = await transport().send(sms());
  assert.strictEqual(unparsed.errors[0].category, 'validation');
  assert.strictEqual(unparsed.retryable, false);
});

test('TurboSMS: a message it created within 90 seconds is of unknown delivery', async (t) => {
  // Before (C15): 427 NOT_ALLOWED_MESSAGE_DUPLICATE, a message that went
  // already, was a permanent refusal.
  for (const response of [
    answer(0, 'x', {
      response_code: 427,
      message_id: null,
      response_status: 'NOT_ALLOWED_MESSAGE_DUPLICATE',
    }),
    answer(427, 'NOT_ALLOWED_MESSAGE_DUPLICATE'),
  ]) {
    t.mock.restoreAll();
    stubFetch(t, () => response.clone());
    const receipt = await transport().send(sms());
    assert.strictEqual(receipt.deliveryUnknown, true);
    assert.strictEqual(receipt.errors[0].code, 'turbosms.427');
  }
});

test('TurboSMS: an answer without its code or id is of unknown delivery', async (t) => {
  stubFetch(t, () =>
    answer(800, 'SUCCESS_MESSAGE_ACCEPTED', { response_code: 0, message_id: null }),
  );
  assert.strictEqual((await transport().send(sms())).deliveryUnknown, true);
  t.mock.restoreAll();
  stubFetch(t, () => new Response('<html>gateway</html>', { status: 200 }));
  assert.strictEqual((await transport().send(sms())).deliveryUnknown, true);
});

test('TurboSMS: what a message cannot be fails before any request', async (t) => {
  const requests = stubFetch(t, () => ok());
  const cases = [
    [sms({ text: 'ж'.repeat(671) }), 'validation', /10 parts/],
    [sms({ media: [{ url: 'https://example.com/a.png' }] }), 'unsupported', /no media/],
    [viber({ text: 'x'.repeat(1001) }), 'validation', /1000 characters/],
    [viber({ to: 'not-a-phone' }), 'validation', /phone number in E.164/],
    [
      viber({
        buttons: [
          { type: 'url', text: 'a', url: 'https://example.com/a' },
          { type: 'url', text: 'b', url: 'https://example.com/b' },
        ],
      }),
      'unsupported',
      /one button/,
    ],
    [
      viber({ buttons: [{ type: 'url', text: 'x'.repeat(31), url: 'https://example.com/' }] }),
      'validation',
      /30 characters/,
    ],
    [sms({ payload: { sequence_id: 'x' } }), 'validation', /cannot set sequence_id/],
    [
      createChannelMessage({ channel: 'telegram', to: '12345', text: 'x' }),
      'unsupported',
      /not messages of telegram/,
    ],
  ];
  for (const [message, category, pattern] of cases) {
    const receipt = await transport().send(message);
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
  }
  assert.match(
    (await transport({ sender: undefined }).send(sms())).errorMessages[0],
    /needs a sender/,
  );
  assert.strictEqual(requests.length, 0);
  assert.throws(() => new TurboSmsTransport({}), /needs token/);
  assert.throws(() => transport({ baseUrl: 'http://api.example.com' }), TypeError);
  assert.ok(!JSON.stringify(transport()).includes(TOKEN));
});

test('TurboSMS: verify reads the balance, whose refusal is a code in a 200', async (t) => {
  const requests = stubFetch(t, () =>
    json({ response_code: 0, response_status: 'OK', response_result: { balance: 12345.67 } }),
  );
  await transport().verify();
  assert.strictEqual(requests[0].url, 'https://api.turbosms.ua/user/balance.json');
  assert.strictEqual(requests[0].method, 'POST');
  assert.strictEqual(requests[0].headers.get('authorization'), `Bearer ${TOKEN}`);
  t.mock.restoreAll();
  stubFetch(t, () => answer(301, 'INVALID_TOKEN'));
  await assert.rejects(transport().verify(), /TurboSMS refused the token: INVALID_TOKEN/);
});
