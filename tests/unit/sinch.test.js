// Not ported: tests of ./sinch against a stubbed fetch, the cases of
// thinwrap's spec of its Sinch connector (the batch of one recipient, the
// Bearer token, the host of the region, the categories of the errors)
// rewritten for this transport.
const { test } = require('node:test');
const assert = require('node:assert');
const { createChannelMessage } = require('../../src/channels/index.js');
const { SinchTransport } = require('../../src/sinch/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const NOW = Date.parse('2026-11-08T10:00:00Z');
const transport = (config = {}) =>
  new SinchTransport({
    servicePlanId: 'plan-123',
    apiToken: 'sinch-api-token',
    from: '+15550001111',
    retries: 0,
    now: () => NOW,
    ...config,
  });
const sms = (fields = {}) =>
  createChannelMessage({
    channel: 'sms',
    to: '+15559876543',
    text: 'Hello from Sinch!',
    ...fields,
  });
const batch = (fields = {}) =>
  json(
    {
      id: '01FC66621XXXXX119Z8PMV1QPQ',
      to: ['15559876543'],
      from: '+15550001111',
      body: 'Hello from Sinch!',
      type: 'mt_text',
      created_at: '2026-11-08T10:00:00.000Z',
      ...fields,
    },
    201,
  );

test('Sinch: an SMS is a batch of one recipient on the host of the region', async (t) => {
  const requests = stubFetch(t, () => batch());
  const receipt = await transport().send(sms());
  const [request] = requests;
  assert.strictEqual(request.url, 'https://us.sms.api.sinch.com/xms/v1/plan-123/batches');
  assert.strictEqual(request.method, 'POST');
  assert.strictEqual(request.headers.get('authorization'), 'Bearer sinch-api-token');
  assert.strictEqual(request.headers.get('content-type'), 'application/json');
  assert.strictEqual(request.redirect, 'manual');
  assert.deepStrictEqual(request.json, {
    to: ['15559876543'],
    body: 'Hello from Sinch!',
    from: '+15550001111',
  });
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: '01FC66621XXXXX119Z8PMV1QPQ',
    provider: 'sinch',
    channel: 'sms',
    state: 'accepted',
    segments: 1,
  });
  t.mock.restoreAll();
  const regional = stubFetch(t, () => batch());
  await transport({ region: 'eu', servicePlanId: 'a/b' }).send(sms());
  assert.strictEqual(regional[0].url, 'https://eu.sms.api.sinch.com/xms/v1/a%2Fb/batches');
});

test('Sinch: the sender, the expiry, the reports and the payload of a batch', async (t) => {
  const requests = stubFetch(t, () => batch());
  await transport({ callbackUrl: 'https://example.com/sinch/dlr' }).send(
    sms({
      from: 'Other',
      text: 'Привіт'.repeat(20),
      expiresAt: new Date(NOW + 3_600_000),
      metadata: { correlationId: 'order-42' },
      payload: { flash_message: true, max_number_of_message_parts: 2 },
    }),
  );
  assert.deepStrictEqual(requests[0].json, {
    to: ['15559876543'],
    body: 'Привіт'.repeat(20),
    from: 'Other',
    expire_at: '2026-11-08T11:00:00.000Z',
    client_reference: 'order-42',
    callback_url: 'https://example.com/sinch/dlr',
    delivery_report: 'per_recipient',
    flash_message: true,
    max_number_of_message_parts: 2,
  });
  const receipt = await transport({ from: undefined, deliveryReport: 'full' }).send(
    sms({ text: 'Привіт'.repeat(20), expiresAt: new Date(NOW + 4 * 86_400_000) }),
  );
  assert.strictEqual(receipt.segments, 2, 'counted here, as Sinch tells none');
  assert.deepStrictEqual(requests[1].json, {
    to: ['15559876543'],
    body: 'Привіт'.repeat(20),
    delivery_report: 'full',
  });
});

test('Sinch: an error is told by its code, then its status', async (t) => {
  const cases = [
    [json({ code: 'unauthorized', text: 'Unauthorized' }, 401), 'auth', false, 'unauthorized'],
    [
      json({ code: 'invalid_recipient', text: 'x' }, 400),
      'invalid-recipient',
      false,
      'invalid_recipient',
    ],
    [
      json({ code: 'syntax_constraint_violation', text: 'x' }, 400),
      'validation',
      false,
      'syntax_constraint_violation',
    ],
    [
      json({ code: 'unprovisioned_region', text: 'x' }, 403),
      'configuration',
      false,
      'unprovisioned_region',
    ],
    [json({ code: 'forbidden', text: 'x' }, 403), 'configuration', false, 'forbidden'],
    [json({ text: 'not found' }, 404), 'configuration', false, 'http_404'],
    [json({ text: 'slow down' }, 429, { 'retry-after': '1' }), 'rate-limit', true, 'http_429'],
    // Changed after C44: a 500 may come once the SMS was taken, which nothing
    // dedupes, so it is of unknown delivery and not sent again; a 503 is.
    [json({ text: 'oops' }, 500), 'server-error', false, 'http_500'],
    [json({ text: 'later' }, 503), 'server-error', true, 'http_503'],
    [json({ text: 'unprocessable' }, 422), 'validation', false, 'http_422'],
  ];
  for (const [response, category, retryable, code] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () => response.clone());
    const receipt = await transport().send(sms());
    assert.strictEqual(receipt.errors[0].category, category, code);
    assert.strictEqual(receipt.retryable, retryable, code);
    assert.strictEqual(receipt.errors[0].code, `sinch.${code}`, code);
  }
  t.mock.restoreAll();
  stubFetch(t, () => json({ code: 'unauthorized', text: 'Invalid token' }, 401));
  assert.match((await transport().send(sms())).errorMessages[0], /Sinch: Invalid token/);
});

test('Sinch: no id is of unknown delivery, and a lost answer is not sent again', async (t) => {
  stubFetch(t, () => json({}, 201));
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

test('Sinch: what an SMS cannot be fails before any request', async (t) => {
  const requests = stubFetch(t, () => batch());
  const cases = [
    [sms({ text: 'x'.repeat(2001) }), 'validation', /more than 2000/],
    [sms({ text: undefined, payload: { tag: 'x' } }), 'validation', /needs a text/],
    [sms({ media: [{ url: 'https://example.com/a.png' }] }), 'unsupported', /no media/],
    [
      sms({ buttons: [{ type: 'url', text: 'x', url: 'https://example.com/' }] }),
      'unsupported',
      /no buttons/,
    ],
    [sms({ payload: { to: ['15550000000'] } }), 'validation', /cannot set to/],
    [sms({ payload: { body: 'other' } }), 'validation', /cannot set body/],
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

test('Sinch: the options are checked when made, the token never shown', () => {
  // From thinwrap: the region is a part of the host the token is sent to.
  assert.throws(() => transport({ region: 'evil.example/' }), /region must be one of/);
  assert.throws(() => transport({ deliveryReport: 'all' }), /deliveryReport must be/);
  assert.throws(() => transport({ callbackUrl: 'http://example.com/dlr' }), TypeError);
  assert.throws(() => transport({ baseUrl: 'http://api.example.com' }), TypeError);
  assert.throws(() => new SinchTransport({ servicePlanId: 'p' }), /needs apiToken/);
  assert.throws(() => new SinchTransport({ apiToken: 't' }), /needs servicePlanId/);
  assert.ok(!JSON.stringify(transport()).includes('sinch-api-token'));
});

test('Sinch: verify lists one batch, a refused token fails it', async (t) => {
  const requests = stubFetch(t, () => json({ count: 0, page: 0, page_size: 1, batches: [] }));
  await transport().verify();
  assert.strictEqual(
    requests[0].url,
    'https://us.sms.api.sinch.com/xms/v1/plan-123/batches?page_size=1',
  );
  assert.strictEqual(requests[0].method, 'GET');
  assert.strictEqual(requests[0].headers.get('authorization'), 'Bearer sinch-api-token');
  t.mock.restoreAll();
  stubFetch(t, () => json({ code: 'unauthorized', text: 'Unauthorized' }, 401));
  await assert.rejects(transport().verify(), (error) => error.statusCode === 401);
});
