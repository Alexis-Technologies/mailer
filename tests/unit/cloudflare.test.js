// Not ported: tests of ./cloudflare, ported from unemail's driver of the
// Cloudflare Email Service REST API, against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');
const { createMessage } = require('../../index.js');
const { CloudflareTransport } = require('../../src/cloudflare/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const ACCOUNT = '023e105f4ecef8ad9ca31a8372d0c353';
const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`;
const transport = (config = {}) =>
  new CloudflareTransport({
    accountId: ACCOUNT,
    apiToken: 'cf-secret',
    retries: 0,
    generateId: () => 'gen-1',
    ...config,
  });
const message = (fields = {}) =>
  createMessage({
    from: { name: 'Shop', address: 'shop@example.com' },
    to: ['bob@example.com'],
    subject: 'Your order',
    content: { text: 'Shipped', html: '<p>Shipped</p>' },
    ...fields,
  });
const sent = (result = {}) =>
  json({
    success: true,
    errors: [],
    messages: [],
    result: {
      message_id: 'cf-1',
      delivered: ['bob@example.com'],
      queued: [],
      permanent_bounces: [],
      ...result,
    },
  });

test('Cloudflare: a message is the request of email/sending/send, in the REST shapes', async (t) => {
  const requests = stubFetch(t, () => sent());
  const receipt = await transport().send(
    message({
      to: ['bob@example.com', { name: 'Carol', address: 'carol@bücher.de' }],
      cc: 'dave@example.com',
      bcc: 'erin@example.com',
      replyTo: { name: 'Desk', address: 'desk@example.com' },
      priority: 'high',
      tags: ['orders'],
      metadata: { orderId: '42' },
      list: { unsubscribe: 'https://example.com/u', oneClick: true },
      attachments: [
        {
          filename: 'r.txt',
          contentType: 'text/plain',
          inline: false,
          contentId: '',
          content: new TextEncoder().encode('hi'),
        },
        {
          filename: 'logo.png',
          contentType: 'image/png',
          inline: true,
          contentId: 'logo@example.com',
          content: new Uint8Array([1]),
        },
      ],
    }),
  );
  assert.deepStrictEqual(receipt, { successful: true, messageId: 'cf-1', provider: 'cloudflare' });
  const [request] = requests;
  assert.strictEqual(request.url, `${BASE}/email/sending/send`);
  assert.strictEqual(request.headers.get('authorization'), 'Bearer cf-secret');
  assert.strictEqual(request.redirect, 'manual');
  // Changed in the port: unemail wrote { email, name }, replyTo and contentId.
  assert.deepStrictEqual(request.json, {
    from: { address: 'shop@example.com', name: 'Shop' },
    subject: 'Your order',
    to: [{ address: 'bob@example.com' }, { address: 'carol@xn--bcher-kva.de', name: 'Carol' }],
    cc: [{ address: 'dave@example.com' }],
    bcc: [{ address: 'erin@example.com' }],
    reply_to: { address: 'desk@example.com', name: 'Desk' },
    text: 'Shipped',
    html: '<p>Shipped</p>',
    headers: {
      'X-Priority': '1',
      'X-MSMail-Priority': 'High',
      Importance: 'High',
      'List-Unsubscribe': '<https://example.com/u>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'X-Metadata-orderId': '42',
    },
    attachments: [
      { content: 'aGk=', filename: 'r.txt', type: 'text/plain', disposition: 'attachment' },
      {
        content: 'AQ==',
        filename: 'logo.png',
        type: 'image/png',
        disposition: 'inline',
        content_id: 'logo@example.com',
      },
    ],
  });
});

test('Cloudflare: a plain message has no headers, and the account is one segment', async (t) => {
  const requests = stubFetch(t, () => sent());
  await transport({ accountId: 'a/b?c', baseUrl: 'http://localhost:9000' }).send(
    message({ to: [], bcc: 'erin@example.com', content: { text: 'plain' } }),
  );
  const [request] = requests;
  assert.strictEqual(request.url, 'http://localhost:9000/accounts/a%2Fb%3Fc/email/sending/send');
  for (const key of ['to', 'cc', 'reply_to', 'html', 'headers', 'attachments']) {
    assert.strictEqual(request.json[key], undefined, key);
  }
});

test('Cloudflare: bounced and suppressed recipients are listed, or fail when none went', async (t) => {
  const answers = [
    sent({ delivered: [], queued: ['bob@example.com'], permanent_bounces: ['carol@example.com'] }),
    sent({ suppressed_recipients: ['dave@example.com'], message_id: undefined }),
    sent({ delivered: [], permanent_bounces: ['bob@example.com'] }),
    sent({ delivered: [], suppressed_recipients: ['bob@example.com'] }),
    sent({ delivered: [] }),
    json({ success: false, errors: [{ code: 10200, message: 'Sender not verified' }] }),
    json({ success: false }),
  ];
  stubFetch(t, () => answers.shift());
  assert.deepStrictEqual(await transport().send(message()), {
    successful: true,
    messageId: 'cf-1',
    provider: 'cloudflare',
    bouncedRecipients: ['carol@example.com'],
  });
  // Changed in the port: unemail made the id of the addresses and the clock.
  assert.deepStrictEqual(await transport().send(message()), {
    successful: true,
    messageId: 'gen-1',
    provider: 'cloudflare',
    suppressedRecipients: ['dave@example.com'],
  });
  for (let i = 0; i < 2; i++) {
    const none = await transport().send(message());
    assert.strictEqual(none.successful, false);
    assert.strictEqual(none.retryable, false);
    assert.strictEqual(none.errors[0].category, 'rejected');
    assert.strictEqual(none.errors[0].code, 'cloudflare.no_recipient_accepted');
    assert.doesNotMatch(none.errorMessages[0], /example\.com/);
  }
  assert.strictEqual((await transport().send(message())).deliveryUnknown, true);
  const refused = await transport().send(message());
  assert.strictEqual(refused.errorMessages[0], 'Cloudflare: Sender not verified');
  assert.strictEqual(refused.errors[0].category, 'validation');
  assert.strictEqual(refused.errors[0].code, 'cloudflare.10200');
  assert.strictEqual(
    (await transport().send(message())).errorMessages[0],
    'Cloudflare: the send failed.',
  );
});

test('Cloudflare: the status of an error chooses its category, its code is kept', async (t) => {
  const answers = [
    json({ success: false, errors: [{ code: 10101, message: 'Invalid API token' }] }, 401),
    json(
      { success: false, errors: [{ code: 10004, message: 'email.sending.error.throttled' }] },
      429,
    ),
    json({ success: false, errors: [] }, 503),
  ];
  stubFetch(t, () => answers.shift());
  const auth = await transport().send(message());
  assert.strictEqual(auth.errorMessages[0], 'Cloudflare: Invalid API token');
  assert.strictEqual(auth.errors[0].category, 'auth');
  assert.strictEqual(auth.errors[0].code, 'cloudflare.10101');
  const throttled = await transport().send(message());
  assert.strictEqual(throttled.errors[0].category, 'rate-limit');
  assert.strictEqual(throttled.retryable, true);
  assert.strictEqual((await transport().send(message())).errors[0].category, 'service-unavailable');
});

test('Cloudflare: its limits and a schedule are refused before a request', async (t) => {
  const requests = stubFetch(t, () => sent());
  const many = [];
  for (let i = 0; i < 26; i++) many.push(`r${i}@example.com`);
  const refusals = [
    [message({ to: many, cc: many }), /at most 50 recipients/],
    [message({ replyTo: ['a@example.com', 'b@example.com'] }), /one reply-to/],
    [message({ scheduledAt: new Date() }), /Unsupported scheduledAt: cloudflare/],
  ];
  for (const [refused, error] of refusals) {
    const receipt = await transport().send(refused);
    assert.match(receipt.errorMessages[0], error);
    assert.strictEqual(receipt.errors[0].category, 'unsupported');
    assert.strictEqual(receipt.retryable, false);
  }
  assert.strictEqual(requests.length, 0);
});

test('Cloudflare: sendRaw sends the MIME text through send_raw', async (t) => {
  const requests = stubFetch(t, () => sent({ message_id: 'cf-raw' }));
  const text = 'From: shop@example.com\r\nTo: bob@example.com\r\nSubject: Grüße\r\n\r\nHi\r\n';
  const receipt = await transport().sendRaw({
    envelope: { from: 'shop@example.com', to: ['bob@example.com', 'erin@bücher.de'] },
    content: new TextEncoder().encode(text),
  });
  assert.strictEqual(receipt.messageId, 'cf-raw');
  assert.strictEqual(requests[0].url, `${BASE}/email/sending/send_raw`);
  assert.deepStrictEqual(requests[0].json, {
    from: 'shop@example.com',
    recipients: ['bob@example.com', 'erin@xn--bcher-kva.de'],
    mime_message: text,
  });
  const bounce = await transport().sendRaw({
    envelope: { from: null, to: ['bob@example.com'] },
    content: new TextEncoder().encode(text),
  });
  assert.strictEqual(bounce.errors[0].category, 'unsupported');
  assert.match(bounce.errorMessages[0], /needs a sender in the envelope/);
  const latin1 = await transport().sendRaw({
    envelope: { from: 'shop@example.com', to: ['bob@example.com'] },
    content: new Uint8Array([...new TextEncoder().encode('Subject: x\r\n\r\n'), 0xe9, 13, 10]),
  });
  assert.match(latin1.errorMessages[0], /Cloudflare takes a raw message only as UTF-8/);
  assert.strictEqual(latin1.errors[0].category, 'unsupported');
  stubFetch(t, () => json({ success: false, errors: [{ code: 10001 }] }, 400));
  const failed = await transport().sendRaw({
    envelope: { from: 'shop@example.com', to: ['bob@example.com'] },
    content: new TextEncoder().encode(text),
  });
  assert.strictEqual(failed.errors[0].code, 'cloudflare.10001');
  assert.strictEqual(requests.length, 1);
});

test('Cloudflare: sendMany sends concurrently, in order', async (t) => {
  let index = 0;
  const requests = stubFetch(t, () => sent({ message_id: `cf-${index++}` }));
  const receipts = [];
  for await (const receipt of transport({ concurrency: 2 }).sendMany([
    message(),
    message({ scheduledAt: new Date() }),
    message(),
  ])) {
    receipts.push(receipt);
  }
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.successful),
    [true, false, true],
  );
  assert.strictEqual(requests.length, 2);
});

test('Cloudflare: verify checks the token of the account, then of a user', async (t) => {
  const active = () => json({ success: true, result: { id: 't', status: 'active' } });
  const answers = [
    active(),
    json({ success: false, errors: [{ code: 1000, message: 'Invalid API Token' }] }, 401),
    active(),
    json({ success: false, errors: [{ code: 1000 }] }, 401),
    json({ success: false, errors: [{ code: 1000, message: 'Invalid API Token' }] }, 401),
    json({ success: true, result: { id: 't', status: 'disabled' } }),
    json({ success: true, result: {} }),
    json({ success: false }, 500),
  ];
  const requests = stubFetch(t, () => answers.shift());
  await transport().verify();
  assert.strictEqual(requests[0].url, `${BASE}/tokens/verify`);
  assert.strictEqual(requests[0].method, 'GET');
  assert.strictEqual(requests[0].headers.get('authorization'), 'Bearer cf-secret');
  await transport().verify();
  assert.strictEqual(requests[2].url, 'https://api.cloudflare.com/client/v4/user/tokens/verify');
  await assert.rejects(transport().verify(), /Cloudflare: Invalid API Token/);
  await assert.rejects(transport().verify(), /the API token is disabled/);
  await assert.rejects(transport().verify(), /the API token is not active/);
  await assert.rejects(transport().verify(), (error) => error.statusCode === 500);
  assert.strictEqual(requests.length, 8);
});

test('Cloudflare: the options are checked, and the token never shows', async () => {
  assert.throws(() => new CloudflareTransport({ apiToken: 't' }), /needs accountId/);
  assert.throws(() => new CloudflareTransport({ accountId: 'a' }), /needs apiToken/);
  assert.throws(() => transport({ baseUrl: 'http://api.example.com' }), /baseUrl/);
  const made = transport();
  assert.ok(!JSON.stringify(made).includes('cf-secret'));
  assert.ok(!util.inspect(made, { depth: 5 }).includes('cf-secret'));
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  await assert.rejects(made.send(message(), { signal: controller.signal }), /stop/);
  await assert.rejects(
    made.sendRaw(
      { envelope: { from: 'a@example.com', to: ['b@example.com'] }, content: 'x' },
      { signal: controller.signal },
    ),
    /stop/,
  );
});
