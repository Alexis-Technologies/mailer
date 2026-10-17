// Not ported: tests of ./mailjet, ported from unemail's Mailjet driver,
// against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');
const { createMessage } = require('../../index.js');
const { MailjetTransport } = require('../../src/mailjet/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const transport = (config = {}) =>
  new MailjetTransport({ apiKey: 'public', apiSecret: 'secret-key', retries: 0, ...config });
const message = (fields = {}) =>
  createMessage({
    from: { name: 'Shop', address: 'shop@example.com' },
    to: ['bob@example.com'],
    subject: 'Your order',
    content: { text: 'Shipped', html: '<p>Shipped</p>' },
    ...fields,
  });
const success = (uuid) => ({
  Status: 'success',
  To: [{ Email: 'x', MessageUUID: uuid, MessageID: 1 }],
});
const failed = (code, text, related = ['To']) => ({
  Status: 'error',
  Errors: [{ ErrorCode: code, StatusCode: 400, ErrorMessage: text, ErrorRelatedTo: related }],
});

test('Mailjet: a message is an entry of Messages, with Basic authentication', async (t) => {
  const requests = stubFetch(t, () => json({ Messages: [success('uuid-1')] }));
  const receipt = await transport({ openTracking: false }).send(
    message({
      to: ['bob@example.com', { name: 'Carol', address: 'carol@bücher.de' }],
      cc: 'dave@example.com',
      bcc: 'erin@example.com',
      replyTo: 'support@example.com',
      tags: ['autumn'],
      metadata: { orderId: '42' },
      tracking: { clicks: true },
      list: { unsubscribe: 'https://example.com/u' },
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
  assert.deepStrictEqual(receipt, { successful: true, messageId: 'uuid-1', provider: 'mailjet' });
  const [request] = requests;
  assert.strictEqual(request.url, 'https://api.mailjet.com/v3.1/send');
  assert.strictEqual(
    request.headers.get('authorization'),
    `Basic ${Buffer.from('public:secret-key').toString('base64')}`,
  );
  assert.strictEqual(request.json.SandboxMode, undefined);
  const [entry] = request.json.Messages;
  assert.deepStrictEqual(entry.From, { Email: 'shop@example.com', Name: 'Shop' });
  assert.deepStrictEqual(entry.To, [
    { Email: 'bob@example.com' },
    { Email: 'carol@xn--bcher-kva.de', Name: 'Carol' },
  ]);
  assert.deepStrictEqual(entry.Cc, [{ Email: 'dave@example.com' }]);
  assert.deepStrictEqual(entry.Bcc, [{ Email: 'erin@example.com' }]);
  assert.deepStrictEqual(entry.ReplyTo, { Email: 'support@example.com' });
  assert.strictEqual(entry.TextPart, 'Shipped');
  assert.strictEqual(entry.HTMLPart, '<p>Shipped</p>');
  assert.strictEqual(entry.CustomCampaign, 'autumn');
  assert.strictEqual(entry.EventPayload, '{"orderId":"42"}');
  assert.strictEqual(entry.TrackOpens, 'disabled');
  assert.strictEqual(entry.TrackClicks, 'enabled');
  assert.deepStrictEqual(entry.Headers, { 'List-Unsubscribe': '<https://example.com/u>' });
  assert.deepStrictEqual(entry.Attachments, [
    { ContentType: 'text/plain', Filename: 'r.txt', Base64Content: 'aGk=' },
  ]);
  assert.deepStrictEqual(entry.InlinedAttachments, [
    {
      ContentType: 'image/png',
      Filename: 'logo.png',
      Base64Content: 'AQ==',
      ContentID: 'logo@example.com',
    },
  ]);
});

test('Mailjet: no tracking without HTML, and the sandbox gives an id of its own', async (t) => {
  const requests = stubFetch(t, () =>
    json({
      Messages: [{ Status: 'success', To: [{ Email: 'x', MessageUUID: '', MessageID: 0 }] }],
    }),
  );
  const receipt = await transport({
    sandbox: true,
    openTracking: true,
    generateId: () => 'g1',
  }).send(message({ content: { text: 'plain' } }));
  assert.strictEqual(receipt.messageId, 'sandbox-g1');
  assert.strictEqual(requests[0].json.SandboxMode, true);
  assert.strictEqual(requests[0].json.Messages[0].TrackOpens, undefined);
  stubFetch(t, () =>
    json({
      Messages: [{ Status: 'success', To: [{ Email: 'x', MessageUUID: '', MessageID: 0 }] }],
    }),
  );
  assert.strictEqual((await transport().send(message())).deliveryUnknown, true);
});

test('Mailjet: a 400 carries the answer of each message, those that went too', async (t) => {
  const requests = stubFetch(t, () =>
    json(
      {
        Messages: [
          success('u-0'),
          failed('send-0003', 'At least "HTMLPart" is required'),
          success('u-2'),
        ],
      },
      400,
    ),
  );
  const receipts = [];
  for await (const receipt of transport().sendMany([
    message(),
    message(),
    message({ tags: ['a', 'b'] }),
    message(),
  ])) {
    receipts.push(receipt);
  }
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.successful),
    [true, false, false, true],
  );
  assert.strictEqual(receipts[0].messageId, 'u-0');
  assert.strictEqual(receipts[1].errorMessages[0], 'Mailjet: To: At least "HTMLPart" is required');
  assert.strictEqual(receipts[1].errors[0].code, 'mailjet.send-0003');
  assert.strictEqual(receipts[1].retryable, false);
  assert.match(receipts[2].errorMessages[0], /one tag per message/);
  assert.strictEqual(receipts[3].messageId, 'u-2');
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].json.Messages.length, 3);
});

test('Mailjet: requests hold at most 50 recipients', async (t) => {
  const requests = stubFetch(t, (request) =>
    json({ Messages: request.json.Messages.map((_, index) => success(`u-${index}`)) }),
  );
  const many = [];
  for (let i = 0; i < 30; i++) many.push(`r${i}@example.com`);
  const receipts = [];
  for await (const receipt of transport().sendMany([
    message({ to: many }),
    message({ to: many.slice(0, 25) }),
    message(),
  ])) {
    receipts.push(receipt);
  }
  assert.deepStrictEqual(
    requests.map((request) => request.json.Messages.length),
    [1, 2],
  );
  assert.ok(receipts.every((receipt) => receipt.successful));
  const tooMany = [];
  for (let i = 0; i < 51; i++) tooMany.push(`r${i}@example.com`);
  assert.match(
    (await transport().send(message({ to: tooMany }))).errorMessages[0],
    /at most 50 recipients/,
  );
});

test('Mailjet: what Mailjet sets itself, and its limits, are refused before a request', async (t) => {
  const requests = stubFetch(t, () => json({ Messages: [success('u')] }));
  const refusals = [
    [message({ list: { id: 'news.example.com' } }), /sets List-ID itself/],
    [message({ headers: { 'X-Mailer': 'Mine 1.0' } }), /sets X-Mailer itself/],
    [message({ subject: 'x'.repeat(256) }), /subject of at most 255/],
    [message({ replyTo: ['a@example.com', 'b@example.com'] }), /one reply-to/],
    [message({ scheduledAt: new Date() }), /Invalid scheduledAt: mailjet/],
  ];
  for (const [refused, error] of refusals) {
    assert.match((await transport().send(refused)).errorMessages[0], error);
  }
  assert.strictEqual(requests.length, 0);
});

test('Mailjet: a failed request fails its messages, an empty answer is unknown', async (t) => {
  const answers = [
    json({ ErrorMessage: 'API key authentication/authorization failure' }, 401),
    json({}),
  ];
  stubFetch(t, () => answers.shift());
  const receipts = [];
  for await (const receipt of transport().sendMany([message(), message()])) receipts.push(receipt);
  assert.strictEqual(receipts.length, 2);
  for (const receipt of receipts) {
    assert.strictEqual(receipt.errors[0].category, 'auth');
    assert.match(receipt.errorMessages[0], /authentication\/authorization failure/);
  }
  assert.strictEqual((await transport().send(message())).deliveryUnknown, true);
});

test('Mailjet: verify reads the profile, the options are checked, the secret never shows', async (t) => {
  const requests = stubFetch(t, () => json({ Data: [] }));
  await transport().verify();
  assert.strictEqual(requests[0].url, 'https://api.mailjet.com/v3/REST/myprofile');
  assert.throws(() => new MailjetTransport({ apiKey: 'public' }), /needs apiSecret/);
  assert.throws(() => transport({ clickTracking: 'on' }), /clickTracking must be a boolean/);
  const made = transport();
  assert.ok(!JSON.stringify(made).includes('secret-key'));
  assert.ok(!util.inspect(made, { depth: 5 }).includes('secret-key'));
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  await assert.rejects(made.send(message(), { signal: controller.signal }), /stop/);
});
