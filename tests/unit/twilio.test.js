// Not ported: tests of ./twilio against a stubbed fetch, the cases of
// thinwrap's spec of its Twilio connector (the form of the Messages API, its
// Basic credentials, the hosts of its regions and edges, the categories of
// its errors) rewritten for this transport, and those of its channels,
// receipts and bugs.
const { test } = require('node:test');
const assert = require('node:assert');
const { createChannelMessage } = require('../../src/channels/index.js');
const { TwilioTransport } = require('../../src/twilio/index.js');
const { hostOf } = require('../../src/twilio/config.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const SID = `AC${'1'.repeat(32)}`;
const MESSAGE_SID = `SM${'f'.repeat(32)}`;
const NOW = Date.parse('2026-11-08T10:00:00Z');
const transport = (config = {}) =>
  new TwilioTransport({
    accountSid: SID,
    authToken: 'auth-token',
    from: '+15005550006',
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
const created = (extra = {}) =>
  json({ sid: MESSAGE_SID, status: 'queued', num_segments: '1', ...extra }, 201);
const refused = (code, status = 400) => json({ code, message: `code ${code}`, status }, status);

test('Twilio: an SMS is the form of the Messages API, with Basic credentials', async (t) => {
  const requests = stubFetch(t, () => created({ num_segments: '3' }));
  const receipt = await transport().send(sms());
  assert.strictEqual(
    requests[0].url,
    `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`,
  );
  assert.strictEqual(
    requests[0].headers.get('authorization'),
    `Basic ${Buffer.from(`${SID}:auth-token`).toString('base64')}`,
  );
  assert.deepStrictEqual(Object.fromEntries(requests[0].form), {
    To: '+380671234567',
    From: '+15005550006',
    Body: 'Your code is 1234',
  });
  // Before (T1): thinwrap made an SMS Twilio took `sent`; it is queued.
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: MESSAGE_SID,
    provider: 'twilio',
    channel: 'sms',
    state: 'accepted',
    segments: 3,
  });
});

test('Twilio: WhatsApp and RCS go by the prefix of their recipient, a template by its ContentSid', async (t) => {
  const requests = stubFetch(t, () => created());
  const twilio = transport({ whatsappFrom: '+14155238886', rcsFrom: 'brand_agent' });
  await twilio.send(
    createChannelMessage({
      channel: 'whatsapp',
      to: '+380671234567',
      template: { name: `HX${'a'.repeat(32)}`, language: 'en', components: [{ 1: '1234' }] },
    }),
  );
  assert.deepStrictEqual(Object.fromEntries(requests[0].form), {
    To: 'whatsapp:+380671234567',
    From: 'whatsapp:+14155238886',
    ContentSid: `HX${'a'.repeat(32)}`,
    ContentVariables: '{"1":"1234"}',
  });
  await twilio.send(createChannelMessage({ channel: 'rcs', to: '+380671234567', text: 'Hi' }));
  assert.strictEqual(requests[1].form.get('To'), 'rcs:+380671234567');
  assert.strictEqual(requests[1].form.get('From'), 'rcs:brand_agent');
  // A message without a sender of its channel goes through the Messaging Service.
  await transport({ from: undefined, messagingServiceSid: `MG${'b'.repeat(32)}` }).send(sms());
  assert.strictEqual(requests[2].form.get('MessagingServiceSid'), `MG${'b'.repeat(32)}`);
  assert.strictEqual(requests[2].form.has('From'), false);
});

test('Twilio: media, validity, the status callback with the correlation id, and the payload', async (t) => {
  const requests = stubFetch(t, () => created());
  await transport({ statusCallback: 'https://example.com/twilio/status?app=1' }).send(
    sms({
      media: [{ url: 'https://example.com/a.png' }, { url: 'https://example.com/b.png' }],
      expiresAt: new Date(NOW + 600_000),
      metadata: { correlationId: 'order-42' },
      payload: { ShortenUrls: 'true', SmartEncoded: true },
    }),
  );
  const { form } = requests[0];
  assert.deepStrictEqual(form.getAll('MediaUrl'), [
    'https://example.com/a.png',
    'https://example.com/b.png',
  ]);
  assert.strictEqual(form.get('ValidityPeriod'), '600');
  assert.strictEqual(
    form.get('StatusCallback'),
    'https://example.com/twilio/status?app=1&correlationId=order-42',
  );
  assert.strictEqual(form.get('ShortenUrls'), 'true');
  assert.strictEqual(form.get('SmartEncoded'), 'true');
  await transport().send(sms({ expiresAt: new Date(NOW + 10 * 86_400_000) }));
  assert.strictEqual(requests[1].form.get('ValidityPeriod'), '36000');
});

test('Twilio: an error is told by its code, a STOP an opt-out', async (t) => {
  // Before (T6): thinwrap made 21610, a STOP, an invalid recipient.
  const cases = [
    [refused(21610), 'opted-out', false],
    [refused(21211), 'invalid-recipient', false],
    [refused(21614), 'invalid-recipient', false],
    // Before (C22): 21612, a pair of To and From that cannot carry it, was a
    // handset out of reach, retried four times and again by the queue.
    [refused(21612), 'configuration', false],
    [refused(30003), 'unreachable', true],
    [refused(63003), 'not-on-channel', false],
    [refused(63016), 'outside-window', false],
    [refused(21408), 'configuration', false],
    [refused(21606), 'configuration', false],
    [refused(21617), 'validation', false],
    [refused(20003, 401), 'auth', false],
    [refused(20429, 429), 'rate-limit', true],
    [refused(99999, 400), 'validation', false],
    [refused(99999, 403), 'configuration', false],
    [new Response('down', { status: 503 }), 'server-error', true],
  ];
  for (const [answer, category, retryable] of cases) {
    t.mock.restoreAll();
    stubFetch(t, () => answer.clone());
    const receipt = await transport().send(sms());
    assert.strictEqual(receipt.errors[0].category, category, category);
    assert.strictEqual(receipt.retryable, retryable, category);
    assert.strictEqual(receipt.channel, 'sms');
  }
});

test('Twilio: a lost answer is not sent again, and the signal ends a request', async (t) => {
  // Before (V7, T11): visulima sent a POST again after its timeout, and
  // thinwrap took no signal and made an abort an invalid request.
  const requests = stubFetch(t, () => {
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
    });
  });
  const receipt = await transport({ retries: 3 }).send(sms());
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(receipt.deliveryUnknown, true);
  t.mock.restoreAll();
  const reason = new Error('the queue stops');
  stubFetch(t, (_request) => new Promise(() => {}));
  const controller = new AbortController();
  const sending = transport().send(sms(), { signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(sending, (error) => error === reason);
});

test('Twilio: an answer without the sid of its message is of unknown delivery', async (t) => {
  stubFetch(t, () => json({ status: 'queued' }, 201));
  assert.strictEqual((await transport().send(sms())).deliveryUnknown, true);
});

test('Twilio: what Twilio would refuse fails before any request', async (t) => {
  const requests = stubFetch(t, () => created());
  const cases = [
    [sms({ text: 'x'.repeat(1601) }), 'validation', /more than 1600/],
    [
      sms({ media: Array.from({ length: 11 }, () => ({ url: 'https://example.com/a.png' })) }),
      'validation',
      /10 media/,
    ],
    [
      sms({ media: [{ content: new Uint8Array(1), contentType: 'image/png' }] }),
      'unsupported',
      /URL Twilio fetches/,
    ],
    [
      sms({ buttons: [{ type: 'url', text: 'x', url: 'https://example.com/' }] }),
      'unsupported',
      /Content API/,
    ],
    [
      createChannelMessage({
        channel: 'whatsapp',
        to: '+380671234567',
        template: { name: 'otp', language: 'en' },
      }),
      'validation',
      /ContentSid/,
    ],
    [sms({ payload: { To: '+1' } }), 'validation', /cannot set To/],
    [
      sms({ text: undefined, payload: { tag: 'x' } }),
      'validation',
      /needs a text, media or a template/,
    ],
    [
      createChannelMessage({ channel: 'rcs', to: '+380671234567', text: 'x' }),
      'validation',
      /needs a sender/,
    ],
  ];
  for (const [message, category, pattern] of cases) {
    const receipt = await transport({ whatsappFrom: '+14155238886' }).send(message);
    assert.strictEqual(receipt.errors[0].category, category, String(pattern));
    assert.match(receipt.errorMessages[0], pattern);
  }
  assert.strictEqual(requests.length, 0);
});

test('Twilio: the host of a region and an edge, and the credentials, are checked when made', () => {
  assert.strictEqual(hostOf(), 'api.twilio.com');
  assert.strictEqual(hostOf('us1', 'ashburn'), 'api.ashburn.us1.twilio.com');
  assert.strictEqual(hostOf('ie1'), 'api.dublin.ie1.twilio.com');
  assert.strictEqual(hostOf('au1', 'sydney'), 'api.sydney.au1.twilio.com');
  assert.throws(() => hostOf('us2'), /us1, ie1 or au1/);
  assert.throws(() => hostOf('us1', 'evil.example/'), /Unknown edge/);
  assert.throws(() => new TwilioTransport({ accountSid: 'AC1', authToken: 't' }), /AC and 32 hex/);
  assert.throws(() => new TwilioTransport({ accountSid: SID }), /authToken or apiKey/);
  assert.throws(
    () => new TwilioTransport({ accountSid: SID, apiKey: { sid: 'x', secret: 's' } }),
    /SK and 32/,
  );
  assert.throws(() => transport({ messagingServiceSid: 'MG1' }), /MG and 32/);
  assert.throws(() => transport({ statusCallback: 'http://example.com/cb' }), TypeError);
  assert.ok(!JSON.stringify(transport()).includes('auth-token'));
});

test('Twilio: an API key signs in its place, and verify reads the account', async (t) => {
  const requests = stubFetch(t, () => json({ sid: SID, status: 'active' }));
  const keyed = new TwilioTransport({
    accountSid: SID,
    apiKey: { sid: `SK${'2'.repeat(32)}`, secret: 'key-secret' },
  });
  await keyed.verify();
  assert.strictEqual(requests[0].url, `https://api.twilio.com/2010-04-01/Accounts/${SID}.json`);
  assert.strictEqual(
    requests[0].headers.get('authorization'),
    `Basic ${Buffer.from(`SK${'2'.repeat(32)}:key-secret`).toString('base64')}`,
  );
  t.mock.restoreAll();
  stubFetch(t, () => refused(20003, 401));
  await assert.rejects(transport().verify(), (error) => error.statusCode === 401);
});
