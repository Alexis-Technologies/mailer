// Not ported: tests of ./mailersend, ported from unemail's and sently's
// MailerSend drivers, against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');
const { createMessage } = require('../../index.js');
const { MailerSendTransport } = require('../../src/mailersend/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const NOW = Date.parse('2026-10-17T12:00:00Z');
const transport = (config = {}) =>
  new MailerSendTransport({ apiKey: 'mlsn.secret', retries: 0, now: () => NOW, ...config });
const message = (fields = {}) =>
  createMessage({
    from: { name: 'Shop', address: 'shop@example.com' },
    to: ['bob@example.com'],
    subject: 'Your order',
    content: { text: 'Shipped', html: '<p>Shipped</p>' },
    ...fields,
  });
const accepted = (id = 'ms-1') =>
  new Response(null, { status: 202, headers: { 'x-message-id': id } });

test('MailerSend: a message is the request of /v1/email, its id a header of the answer', async (t) => {
  const requests = stubFetch(t, () => accepted());
  const receipt = await transport({ precedenceBulk: true, clickTracking: false }).send(
    message({
      to: ['bob@example.com', { name: 'Carol', address: 'carol@bücher.de' }],
      cc: 'dave@example.com',
      bcc: 'erin@example.com',
      replyTo: 'support@example.com',
      priority: 'high',
      tags: ['orders', 'eu'],
      metadata: { orderId: '42' },
      tracking: { opens: true },
      inReplyTo: ['a@example.com'],
      references: ['r1@example.com', 'a@example.com'],
      list: { unsubscribe: 'https://example.com/u', oneClick: true },
      scheduledAt: new Date(NOW + 3600_000),
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
  assert.deepStrictEqual(receipt, { successful: true, messageId: 'ms-1', provider: 'mailersend' });
  const [request] = requests;
  assert.strictEqual(request.url, 'https://api.mailersend.com/v1/email');
  assert.strictEqual(request.headers.get('authorization'), 'Bearer mlsn.secret');
  const body = request.json;
  assert.deepStrictEqual(body.from, { email: 'shop@example.com', name: 'Shop' });
  assert.deepStrictEqual(body.to, [
    { email: 'bob@example.com' },
    { email: 'carol@xn--bcher-kva.de', name: 'Carol' },
  ]);
  assert.deepStrictEqual(body.reply_to, { email: 'support@example.com' });
  assert.strictEqual(body.in_reply_to, 'a@example.com');
  assert.deepStrictEqual(body.references, ['r1@example.com', 'a@example.com']);
  assert.strictEqual(body.list_unsubscribe, '<https://example.com/u>');
  assert.deepStrictEqual(body.tags, ['orders', 'eu']);
  assert.deepStrictEqual(body.settings, { track_opens: true, track_clicks: false });
  assert.strictEqual(body.precedence_bulk, true);
  assert.strictEqual(body.send_at, Math.floor((NOW + 3600_000) / 1000));
  assert.deepStrictEqual(body.headers, [
    { name: 'X-Priority', value: '1' },
    { name: 'X-MSMail-Priority', value: 'High' },
    { name: 'Importance', value: 'High' },
    { name: 'X-Metadata-orderId', value: '42' },
  ]);
  assert.deepStrictEqual(body.attachments, [
    { filename: 'r.txt', content: 'aGk=', disposition: 'attachment' },
    { filename: 'logo.png', content: 'AQ==', disposition: 'inline', id: 'logo@example.com' },
  ]);
});

test('MailerSend: a plain message has no settings or headers, an answer without id is unknown', async (t) => {
  const answers = [accepted('ms-2'), new Response(null, { status: 202 })];
  const requests = stubFetch(t, () => answers.shift());
  const receipt = await transport().send(message({ content: { text: 'plain' } }));
  assert.strictEqual(receipt.messageId, 'ms-2');
  const body = requests[0].json;
  assert.strictEqual(body.settings, undefined);
  assert.strictEqual(body.headers, undefined);
  assert.strictEqual(body.html, undefined);
  assert.strictEqual(body.text, 'plain');
  const unknown = await transport().send(message());
  assert.strictEqual(unknown.deliveryUnknown, true);
});

test('MailerSend: a 422 names the fields and their reasons', async (t) => {
  stubFetch(t, () =>
    json(
      {
        message: 'The given data was invalid.',
        errors: {
          'from.email': ['The from.email domain must be verified.'],
          subject: ['Required.'],
        },
      },
      422,
    ),
  );
  const receipt = await transport().send(message());
  assert.strictEqual(
    receipt.errorMessages[0],
    'MailerSend: from.email: The from.email domain must be verified.; subject: Required.',
  );
  assert.strictEqual(receipt.errors[0].category, 'validation');
  assert.strictEqual(receipt.retryable, false);
});

test('MailerSend: its limits are refused before a request', async (t) => {
  const requests = stubFetch(t, () => accepted());
  const many = (count) => {
    const list = [];
    for (let i = 0; i < count; i++) list.push(`r${i}@example.com`);
    return list;
  };
  const refusals = [
    [message({ to: many(51) }), /at most 50 to recipients/],
    [message({ cc: many(11) }), /at most 10 cc recipients/],
    [message({ bcc: many(11) }), /at most 10 bcc recipients/],
    [message({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] }), /at most 5 tags/],
    [message({ replyTo: ['a@example.com', 'b@example.com'] }), /one reply-to/],
    [message({ scheduledAt: new Date(NOW + 73 * 3600_000) }), /72 hours ahead/],
  ];
  for (const [refused, error] of refusals) {
    assert.match((await transport().send(refused)).errorMessages[0], error);
  }
  assert.strictEqual(requests.length, 0);
});

test('MailerSend: sendMany sends concurrently, verify reads the domains', async (t) => {
  let index = 0;
  const requests = stubFetch(t, (request) =>
    request.method === 'GET' ? json({ data: [] }) : accepted(`ms-${index++}`),
  );
  const receipts = [];
  for await (const receipt of transport().sendMany([
    message(),
    message({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] }),
  ])) {
    receipts.push(receipt);
  }
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.successful),
    [true, false],
  );
  await transport().verify();
  assert.strictEqual(requests.at(-1).url, 'https://api.mailersend.com/v1/domains');
});

test('MailerSend: the options are checked, and the token never shows', () => {
  assert.throws(() => new MailerSendTransport({}), /needs apiKey/);
  assert.throws(() => transport({ precedenceBulk: 'yes' }), /precedenceBulk must be a boolean/);
  const made = transport();
  assert.ok(!JSON.stringify(made).includes('mlsn.secret'));
  assert.ok(!util.inspect(made, { depth: 5 }).includes('mlsn.secret'));
});
