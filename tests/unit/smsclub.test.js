// Not ported: tests of ./smsclub against a stubbed fetch, the answers of the
// examples of SMS Club's documentation: the request of /sms/send, the id of
// its answer, and the statuses of its refusals.
const { test } = require('node:test');
const assert = require('node:assert');
const { createChannelMessage } = require('../../src/channels/index.js');
const { SmsClubTransport } = require('../../src/smsclub/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const TOKEN = 'SmsClubTokenSecret0123';
const transport = (config = {}) =>
  new SmsClubTransport({ token: TOKEN, sender: 'VashZakaz', retries: 0, ...config });
const sms = (fields = {}) =>
  createChannelMessage({ channel: 'sms', to: '+380989361131', text: 'test text', ...fields });
const ok = () => json({ success_request: { info: { 106: '380989361131' } } });

test('SMS Club: an SMS is /sms/send with the token, the key of info its id', async (t) => {
  const requests = stubFetch(t, () => ok());
  const receipt = await transport().send(sms());
  assert.strictEqual(requests[0].url, 'https://im.smsclub.mobi/sms/send');
  assert.strictEqual(requests[0].headers.get('authorization'), `Bearer ${TOKEN}`);
  assert.deepStrictEqual(requests[0].json, {
    phone: ['380989361131'],
    message: 'test text',
    src_addr: 'VashZakaz',
  });
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: '106',
    provider: 'smsclub',
    channel: 'sms',
    state: 'accepted',
    segments: 1,
  });
  await transport().send(sms({ from: 'Other', payload: { integration_id: 7 } }));
  assert.strictEqual(requests[1].json.src_addr, 'Other');
  assert.strictEqual(requests[1].json.integration_id, 7);
});

test('SMS Club: a refusal is told by its status', async (t) => {
  const cases = [
    [400, 'validation', false],
    [401, 'auth', false],
    [429, 'rate-limit', true],
    [453, 'rejected', false],
  ];
  for (const [status, category, retryable] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () =>
      json({ error: 'refused' }, status, status === 429 ? { 'retry-after': '1' } : {}),
    );
    const receipt = await transport().send(sms());
    assert.strictEqual(receipt.errors[0].category, category, String(status));
    assert.strictEqual(receipt.retryable, retryable, String(status));
    assert.strictEqual(receipt.errors[0].code, `smsclub.http_${status}`, String(status));
  }
});

test('SMS Club: an answer without an id is a refusal or of unknown delivery', async (t) => {
  stubFetch(t, () =>
    json({ success_request: { info: {}, add_info: { 380989361131: 'bad number' } } }),
  );
  const refused = await transport().send(sms());
  assert.strictEqual(refused.errors[0].category, 'rejected');
  assert.match(refused.errorMessages[0], /bad number/);
  t.mock.restoreAll();
  stubFetch(t, () => json({}));
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

test('SMS Club: what an SMS cannot be fails before any request', async (t) => {
  const requests = stubFetch(t, () => ok());
  const cases = [
    [sms({ media: [{ url: 'https://example.com/a.png' }] }), 'unsupported', /no media/],
    [
      sms({ buttons: [{ type: 'url', text: 'x', url: 'https://example.com/' }] }),
      'unsupported',
      /no buttons/,
    ],
    [sms({ text: undefined, payload: {} }), 'validation', /needs a text/],
    [sms({ payload: { message: 'other' } }), 'validation', /cannot set message/],
    [
      createChannelMessage({ channel: 'viber', to: '+380989361131', text: 'x' }),
      'unsupported',
      /not messages of viber/,
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
  assert.throws(() => new SmsClubTransport({}), /needs token/);
  assert.throws(() => transport({ baseUrl: 'http://api.example.com' }), TypeError);
  assert.ok(!JSON.stringify(transport()).includes(TOKEN));
});

test('SMS Club: verify reads the balance with the token', async (t) => {
  const requests = stubFetch(t, () =>
    json({ success_request: { info: { money: '8121.1800', currency: 'UAH' } } }),
  );
  await transport().verify();
  assert.strictEqual(requests[0].url, 'https://im.smsclub.mobi/sms/balance');
  assert.strictEqual(requests[0].method, 'POST');
  assert.strictEqual(requests[0].headers.get('authorization'), `Bearer ${TOKEN}`);
  t.mock.restoreAll();
  stubFetch(t, () => json({}, 401));
  await assert.rejects(transport().verify(), (error) => error.statusCode === 401);
});
