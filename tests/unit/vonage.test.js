// Not ported: tests of ./vonage against a stubbed fetch, the cases of
// thinwrap's spec of its Vonage connector (the form of /sms/json, the status
// of a message in a 200) rewritten for this transport, and those of its parts
// and bugs.
const { test } = require('node:test');
const assert = require('node:assert');
const { createChannelMessage } = require('../../src/channels/index.js');
const { VonageTransport } = require('../../src/vonage/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const NOW = Date.parse('2026-11-08T10:00:00Z');
const transport = (config = {}) =>
  new VonageTransport({
    apiKey: 'key',
    apiSecret: 'secret',
    from: 'MyBrand',
    retries: 0,
    now: () => NOW,
    ...config,
  });
const sms = (fields = {}) =>
  createChannelMessage({
    channel: 'sms',
    to: '+380671234567',
    text: 'Your code is 1234',
    ...fields,
  });
const parts = (...statuses) =>
  json({
    'message-count': String(statuses.length),
    messages: statuses.map((status, index) => ({
      to: '380671234567',
      'message-id': `id-${index}`,
      status,
      ...(status !== '0' && { 'error-text': `status ${status}` }),
    })),
  });

test('Vonage: an SMS is the form of /sms/json, unicode for a text beyond GSM-7', async (t) => {
  const requests = stubFetch(t, () => parts('0'));
  const receipt = await transport({ callback: 'https://example.com/vonage/dlr' }).send(
    sms({ metadata: { correlationId: 'order-42' }, expiresAt: new Date(NOW + 60_000) }),
  );
  assert.strictEqual(requests[0].url, 'https://rest.nexmo.com/sms/json');
  assert.deepStrictEqual(Object.fromEntries(requests[0].form), {
    api_key: 'key',
    api_secret: 'secret',
    from: 'MyBrand',
    to: '380671234567',
    text: 'Your code is 1234',
    'client-ref': 'order-42',
    callback: 'https://example.com/vonage/dlr',
    ttl: '60000',
  });
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: 'id-0',
    provider: 'vonage',
    channel: 'sms',
    state: 'accepted',
    segments: 1,
  });
  await transport().send(
    sms({ text: 'Ваш код 1234', from: 'Other', expiresAt: new Date(NOW + 1000) }),
  );
  assert.strictEqual(requests[1].form.get('type'), 'unicode');
  assert.strictEqual(requests[1].form.get('from'), 'Other');
  assert.strictEqual(requests[1].form.get('ttl'), '20000');
});

test('Vonage: every part is read, its segments counted, a later failure not lost', async (t) => {
  // Before (T2): thinwrap read messages[0] alone, lost the segments, and a
  // failure of a later part was a success.
  stubFetch(t, () => parts('0', '0', '0'));
  const receipt = await transport().send(sms({ text: 'x'.repeat(400) }));
  assert.strictEqual(receipt.segments, 3);
  t.mock.restoreAll();
  stubFetch(t, () => parts('0', '5'));
  const partial = await transport().send(sms({ text: 'x'.repeat(200) }));
  assert.strictEqual(partial.successful, false);
  assert.strictEqual(partial.deliveryUnknown, true, 'the recipient may hold the first part');
  assert.strictEqual(partial.segments, 2);
  t.mock.restoreAll();
  stubFetch(t, () => parts('6'));
  const refused = await transport().send(sms());
  assert.strictEqual(refused.deliveryUnknown, undefined);
});

test('Vonage: the status of a message in a 200 is its category', async (t) => {
  const cases = [
    ['1', 'rate-limit', true],
    ['2', 'validation', false],
    ['4', 'auth', false],
    ['5', 'server-error', true],
    ['6', 'invalid-recipient', false],
    ['7', 'opted-out', false],
    ['9', 'configuration', false],
    ['15', 'configuration', false],
    ['29', 'configuration', false],
    ['33', 'invalid-recipient', false],
    ['99', 'validation', false],
  ];
  for (const [status, category, retryable] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () => parts(status));
    const receipt = await transport().send(sms());
    assert.strictEqual(receipt.errors[0].category, category, status);
    assert.strictEqual(receipt.errors[0].code, `vonage.${status}`, status);
    assert.strictEqual(receipt.retryable, retryable, status);
  }
});

test('Vonage: no part is of unknown delivery, and a lost answer is not sent again', async (t) => {
  stubFetch(t, () => json({ 'message-count': '0', messages: [] }));
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

test('Vonage: what an SMS cannot be fails before any request', async (t) => {
  const requests = stubFetch(t, () => parts('0'));
  const cases = [
    [sms({ text: 'x'.repeat(3201) }), 'validation', /more than 3200/],
    [sms({ text: undefined, payload: {} }), 'validation', /needs a text/],
    [sms({ media: [{ url: 'https://example.com/a.png' }] }), 'unsupported', /no media/],
    [
      sms({ buttons: [{ type: 'url', text: 'x', url: 'https://example.com/' }] }),
      'unsupported',
      /no buttons/,
    ],
    [sms({ payload: { api_secret: 'x' } }), 'validation', /cannot set api_secret/],
  ];
  for (const [message, category, pattern] of cases) {
    const receipt = await transport().send(message);
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
  }
  assert.match(
    (await transport({ from: undefined }).send(sms())).errorMessages[0],
    /needs a sender/,
  );
  assert.strictEqual(requests.length, 0);
  assert.throws(() => new VonageTransport({ apiKey: 'k' }), /needs apiSecret/);
  assert.throws(() => transport({ callback: 'http://example.com/dlr' }), TypeError);
  assert.ok(!JSON.stringify(transport()).includes('secret'));
});

test('Vonage: verify reads the balance with Basic credentials, not the query', async (t) => {
  const requests = stubFetch(t, () => json({ value: 10.5, autoReload: false }));
  await transport().verify();
  assert.strictEqual(requests[0].url, 'https://rest.nexmo.com/account/get-balance');
  assert.strictEqual(
    requests[0].headers.get('authorization'),
    `Basic ${Buffer.from('key:secret').toString('base64')}`,
  );
  t.mock.restoreAll();
  stubFetch(t, () =>
    json({ 'error-code': '401', 'error-code-label': 'authentication failed' }, 401),
  );
  await assert.rejects(transport().verify(), (error) => error.statusCode === 401);
});
