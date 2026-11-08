// Not ported: tests of ./alphasms against a stubbed fetch, the answers of the
// examples of AlphaSMS's documentation: the item of api/json.php, its key and
// id, Viber and its hybrid with SMS, and the success of an answer and of its
// item.
const { test } = require('node:test');
const assert = require('node:assert');
const { createChannelMessage } = require('../../src/channels/index.js');
const { AlphaSmsTransport } = require('../../src/alphasms/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const NOW = Date.parse('2026-11-08T10:00:00Z');
const KEY = 'bb56a4369eb19AlphaKeySecret';
const transport = (config = {}) =>
  new AlphaSmsTransport({
    apiKey: KEY,
    sender: 'MyBrand',
    retries: 0,
    now: () => NOW,
    generateId: () => 100500,
    ...config,
  });
const sms = (fields = {}) =>
  createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'Ваш код 1234', ...fields });
const viber = (fields = {}) =>
  createChannelMessage({ channel: 'viber', to: '+380671234567', text: 'Ваш код 1234', ...fields });
const ok = (parts = 1) =>
  json({
    success: true,
    data: [{ success: true, data: { id: 100500, msg_id: 123456789, parts } }],
  });

test('AlphaSMS: an SMS is an item of api/json.php with the key in the body', async (t) => {
  const requests = stubFetch(t, () => ok());
  const receipt = await transport({ hook: 'https://example.com/alphasms' }).send(
    sms({ expiresAt: new Date(NOW + 7_200_000) }),
  );
  assert.strictEqual(requests[0].url, 'https://api.alphasms.ua/api/json.php');
  assert.strictEqual(requests[0].headers.get('authorization'), null);
  assert.deepStrictEqual(requests[0].json, {
    auth: KEY,
    data: [
      {
        type: 'sms',
        id: 100500,
        phone: 380671234567,
        sms_signature: 'MyBrand',
        sms_message: 'Ваш код 1234',
        sms_lifetime: 7200,
        hook: 'https://example.com/alphasms',
      },
    ],
  });
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: '123456789',
    provider: 'alphasms',
    channel: 'sms',
    state: 'accepted',
    segments: 1,
  });
  await transport().send(sms({ idempotencyKey: 'order-42', expiresAt: new Date(NOW + 1000) }));
  const { id, sms_lifetime: lifetime } = requests[1].json.data[0];
  assert.ok(Number.isSafeInteger(id) && id !== 100500, 'a number of the key');
  assert.strictEqual(lifetime, 3600);
  await transport().send(sms({ idempotencyKey: 'order-42' }));
  assert.strictEqual(requests[2].json.data[0].id, id);
});

test('AlphaSMS: Viber as a text, a picture, or both with a button, and its hybrid', async (t) => {
  const requests = stubFetch(t, () => ok());
  await transport({ viberSender: 'MyBrandViber' }).send(viber());
  assert.deepStrictEqual(requests[0].json.data[0], {
    type: 'viber',
    id: 100500,
    phone: 380671234567,
    viber_signature: 'MyBrandViber',
    viber_type: 'text',
    viber_message: 'Ваш код 1234',
  });
  await transport().send(
    viber({
      text: undefined,
      media: [{ url: 'https://example.com/a.png' }],
      expiresAt: new Date(NOW + 10_000),
    }),
  );
  assert.strictEqual(requests[1].json.data[0].viber_type, 'image');
  assert.strictEqual(requests[1].json.data[0].viber_image, 'https://example.com/a.png');
  assert.strictEqual(requests[1].json.data[0].viber_lifetime, 60);
  await transport().send(
    viber({
      media: [{ url: 'https://example.com/a.png' }],
      buttons: [{ type: 'url', text: 'Track', url: 'https://example.com/t/1' }],
      payload: { type: 'viber+sms', sms_message: 'Ваш код 1234' },
    }),
  );
  assert.deepStrictEqual(requests[2].json.data[0], {
    type: 'viber+sms',
    id: 100500,
    phone: 380671234567,
    viber_signature: 'MyBrand',
    viber_type: 'text+image+link',
    viber_message: 'Ваш код 1234',
    viber_image: 'https://example.com/a.png',
    viber_link: 'https://example.com/t/1',
    viber_button: 'Track',
    sms_message: 'Ваш код 1234',
    sms_signature: 'MyBrand',
  });
});

test('AlphaSMS: the success of the answer, then of its item, by the words of its error', async (t) => {
  const cases = [
    [json({ success: false, error: 'Access denied' }), 'auth'],
    [
      json({
        success: true,
        data: [{ success: false, error: 'Error in Alpha-name', data: { id: 1 } }],
      }),
      'configuration',
    ],
    [
      json({ success: true, data: [{ success: false, error: 'Not enough money' }] }),
      'configuration',
    ],
    [
      json({ success: true, data: [{ success: false, error: 'Invalid phone' }] }),
      'invalid-recipient',
    ],
    [json({ success: true, data: [{ success: false, error: 'Something new' }] }), 'rejected'],
  ];
  for (const [response, category] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () => response.clone());
    const receipt = await transport().send(sms());
    assert.strictEqual(receipt.errors[0].category, category, category);
    assert.strictEqual(receipt.retryable, false, category);
  }
  t.mock.restoreAll();
  stubFetch(t, () => json({ success: false, error: 'Access denied' }));
  assert.match((await transport().send(sms())).errorMessages[0], /AlphaSMS: Access denied/);
});

test('AlphaSMS: no msg_id is of unknown delivery, and a lost answer is not sent again', async (t) => {
  stubFetch(t, () => json({ success: true, data: [{ success: true, data: { id: 1 } }] }));
  assert.strictEqual((await transport().send(sms())).deliveryUnknown, true);
  t.mock.restoreAll();
  const requests = stubFetch(t, () => {
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    });
  });
  assert.strictEqual((await transport({ retries: 3 }).send(sms())).deliveryUnknown, true);
  assert.strictEqual(requests.length, 1);
});

test('AlphaSMS: what a message cannot be fails before any request', async (t) => {
  const requests = stubFetch(t, () => ok());
  const cases = [
    [sms({ media: [{ url: 'https://example.com/a.png' }] }), 'unsupported', /no media/],
    [viber({ text: 'x'.repeat(1001) }), 'validation', /1000 characters/],
    [viber({ to: 'not-a-phone' }), 'validation', /phone number in E.164/],
    [
      viber({ buttons: [{ type: 'url', text: 'x', url: 'https://example.com/' }] }),
      'unsupported',
      /a text, a picture, or both/,
    ],
    [
      viber({ buttons: [{ type: 'reply', text: 'x', id: 'x' }] }),
      'unsupported',
      /one button, a link/,
    ],
    [sms({ payload: { phone: 1 } }), 'validation', /cannot set phone/],
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
    /needs a signature/,
  );
  assert.strictEqual(requests.length, 0);
  assert.throws(() => new AlphaSmsTransport({}), /needs apiKey/);
  assert.throws(() => transport({ hook: 'http://example.com/hook' }), TypeError);
  assert.ok(!JSON.stringify(transport()).includes(KEY));
});

test('AlphaSMS: verify reads the balance, whose refusal is in a 200', async (t) => {
  const requests = stubFetch(t, () =>
    json({ success: true, data: [{ success: true, data: { amount: 31.1683, currency: 'UAH' } }] }),
  );
  await transport().verify();
  assert.strictEqual(requests[0].url, 'https://api.alphasms.ua/api/json.php');
  assert.deepStrictEqual(requests[0].json, { auth: KEY, data: [{ type: 'balance' }] });
  t.mock.restoreAll();
  stubFetch(t, () => json({ success: false, error: 'Access denied' }));
  await assert.rejects(transport().verify(), /AlphaSMS refused the key: Access denied/);
});
