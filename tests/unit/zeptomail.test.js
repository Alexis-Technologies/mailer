// Not ported: tests of ./zeptomail, ported from unemail's ZeptoMail driver,
// against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');
const { createMessage } = require('../../index.js');
const { ZeptoMailTransport } = require('../../src/zeptomail/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const transport = (config = {}) =>
  new ZeptoMailTransport({ token: 'zm-secret', retries: 0, ...config });
const message = (fields = {}) =>
  createMessage({
    from: { name: 'Shop', address: 'shop@example.com' },
    to: ['bob@example.com'],
    subject: 'Your order',
    content: { text: 'Shipped', html: '<p>Shipped</p>' },
    ...fields,
  });
const accepted = (id = 'zm-1') =>
  json({ data: [{ code: 'EM_104', message: 'Email request received' }], request_id: id }, 201);
const failure = (code, text, detail, status = 400) =>
  json({ error: { code, message: text, details: detail === undefined ? [] : [detail] } }, status);

test('ZeptoMail: a message is the request of /v1.1/email, with the token', async (t) => {
  const requests = stubFetch(t, () => accepted());
  const receipt = await transport({
    bounceAddress: 'bounce@b.example.com',
    clickTracking: true,
  }).send(
    message({
      to: ['bob@example.com', { name: 'Carol', address: 'carol@bücher.de' }],
      cc: 'dave@example.com',
      bcc: 'erin@example.com',
      replyTo: ['support@example.com', { name: 'Desk', address: 'desk@example.com' }],
      priority: 'low',
      tags: ['order-42'],
      metadata: { orderId: '42' },
      tracking: { opens: false },
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
  assert.deepStrictEqual(receipt, { successful: true, messageId: 'zm-1', provider: 'zeptomail' });
  const [request] = requests;
  assert.strictEqual(request.url, 'https://api.zeptomail.com/v1.1/email');
  assert.strictEqual(request.headers.get('authorization'), 'Zoho-enczapikey zm-secret');
  assert.strictEqual(request.redirect, 'manual');
  const body = request.json;
  assert.deepStrictEqual(body.from, { address: 'shop@example.com', name: 'Shop' });
  assert.deepStrictEqual(body.to, [
    { email_address: { address: 'bob@example.com' } },
    { email_address: { address: 'carol@xn--bcher-kva.de', name: 'Carol' } },
  ]);
  assert.deepStrictEqual(body.cc, [{ email_address: { address: 'dave@example.com' } }]);
  assert.deepStrictEqual(body.bcc, [{ email_address: { address: 'erin@example.com' } }]);
  assert.deepStrictEqual(body.reply_to, [
    { address: 'support@example.com' },
    { address: 'desk@example.com', name: 'Desk' },
  ]);
  assert.strictEqual(body.subject, 'Your order');
  assert.strictEqual(body.textbody, 'Shipped');
  assert.strictEqual(body.htmlbody, '<p>Shipped</p>');
  assert.strictEqual(body.client_reference, 'order-42');
  assert.strictEqual(body.bounce_address, 'bounce@b.example.com');
  assert.strictEqual(body.track_opens, false);
  assert.strictEqual(body.track_clicks, true);
  assert.deepStrictEqual(body.mime_headers, {
    'X-Priority': '5',
    'X-MSMail-Priority': 'Low',
    Importance: 'Low',
    'List-Unsubscribe': '<https://example.com/u>',
    'X-Metadata-orderId': '42',
  });
  assert.deepStrictEqual(body.attachments, [
    { content: 'aGk=', mime_type: 'text/plain', name: 'r.txt' },
  ]);
  assert.deepStrictEqual(body.inline_images, [
    { content: 'AQ==', mime_type: 'image/png', cid: 'logo@example.com' },
  ]);
});

test('ZeptoMail: a plain message sends no options, a token keeps a scheme given', async (t) => {
  const requests = stubFetch(t, () => accepted());
  await transport({ token: 'Zoho-enczapikey zm-secret', clientReference: 'ref' }).send(
    message({ content: { text: 'plain' } }),
  );
  const [request] = requests;
  assert.strictEqual(request.headers.get('authorization'), 'Zoho-enczapikey zm-secret');
  const body = request.json;
  assert.strictEqual(body.client_reference, 'ref');
  assert.strictEqual(body.htmlbody, undefined);
  for (const key of ['mime_headers', 'track_opens', 'track_clicks', 'bounce_address', 'cc']) {
    assert.strictEqual(body[key], undefined, key);
  }
});

test('ZeptoMail: the codes of the details say what failed', async (t) => {
  const answers = [
    failure('TM_4001', 'Access Denied', {
      code: 'SERR_157',
      message: 'Invalid API Token found',
    }),
    failure('TM_4001', 'Access Denied', { code: 'SM_133', message: 'Rate limit exceeded' }),
    failure('TM_4001', 'Access Denied', { code: 'LE_102', message: 'Credits exhausted' }),
    failure('TM_3201', 'Mandatory Field Missing', {
      code: 'SERR_101',
      message: 'Mandatory field missing',
      target: 'subject',
    }),
    failure('TM_5001', 'Internal error', undefined, 400),
    json({ data: [] }, 201),
  ];
  stubFetch(t, () => answers.shift());
  const auth = await transport().send(message());
  assert.strictEqual(auth.errorMessages[0], 'ZeptoMail: Access Denied: Invalid API Token found');
  assert.strictEqual(auth.errors[0].category, 'auth');
  assert.strictEqual(auth.errors[0].code, 'zeptomail.SERR_157');
  const limited = await transport().send(message());
  assert.strictEqual(limited.errors[0].category, 'rate-limit');
  assert.strictEqual(limited.retryable, true);
  const exhausted = await transport().send(message());
  assert.strictEqual(exhausted.errors[0].category, 'configuration');
  assert.strictEqual(exhausted.retryable, false);
  const invalid = await transport().send(message());
  assert.strictEqual(
    invalid.errorMessages[0],
    'ZeptoMail: Mandatory Field Missing: Mandatory field missing: subject',
  );
  assert.strictEqual(invalid.errors[0].category, 'validation');
  const other = await transport().send(message());
  assert.strictEqual(other.errors[0].code, 'zeptomail.TM_5001');
  assert.strictEqual(other.errors[0].category, 'validation');
  assert.strictEqual((await transport().send(message())).deliveryUnknown, true);
});

test('ZeptoMail: its limits, a second tag and a schedule are refused before a request', async (t) => {
  const requests = stubFetch(t, () => accepted());
  const many = (count) => {
    const list = [];
    for (let i = 0; i < count; i++) list.push(`r${i}@example.com`);
    return list;
  };
  const files = [];
  for (let i = 0; i < 61; i++) {
    files.push({
      filename: `f${i}.txt`,
      contentType: 'text/plain',
      inline: false,
      contentId: '',
      content: new Uint8Array(1),
    });
  }
  const refusals = [
    [message({ to: many(501) }), /at most 500 to recipients/],
    [message({ cc: many(501) }), /at most 500 cc recipients/],
    [message({ bcc: many(501) }), /at most 500 bcc recipients/],
    [message({ attachments: files }), /at most 60 attachments/],
    [message({ subject: 'x'.repeat(501) }), /subject of at most 500/],
    [message({ tags: ['a', 'b'] }), /one tag per message/],
    [message({ scheduledAt: new Date() }), /Invalid scheduledAt: zeptomail/],
  ];
  for (const [refused, error] of refusals) {
    assert.match((await transport().send(refused)).errorMessages[0], error);
  }
  assert.strictEqual(requests.length, 0);
});

test('ZeptoMail: sendMany sends concurrently, in order', async (t) => {
  let index = 0;
  const requests = stubFetch(t, () => accepted(`zm-${index++}`));
  const receipts = [];
  for await (const receipt of transport({ concurrency: 2 }).sendMany([
    message(),
    message({ tags: ['a', 'b'] }),
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

test('ZeptoMail: the options are checked, and the token never shows', async () => {
  assert.throws(() => new ZeptoMailTransport({}), /needs token/);
  assert.throws(() => transport({ bounceAddress: '' }), /bounceAddress/);
  assert.throws(() => transport({ openTracking: 'yes' }), /openTracking must be a boolean/);
  assert.throws(() => transport({ baseUrl: 'http://api.zeptomail.eu' }), /baseUrl/);
  const made = transport({ baseUrl: 'https://api.zeptomail.eu' });
  assert.ok(!JSON.stringify(made).includes('zm-secret'));
  assert.ok(!util.inspect(made, { depth: 5 }).includes('zm-secret'));
  assert.strictEqual('verify' in made, false);
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  await assert.rejects(made.send(message(), { signal: controller.signal }), /stop/);
});
