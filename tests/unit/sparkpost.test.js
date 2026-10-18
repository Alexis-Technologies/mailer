// Not ported: tests of ./sparkpost, ported from sently's SparkPost transport,
// against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');
const { createMessage } = require('../../index.js');
const { SparkPostTransport } = require('../../src/sparkpost/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const transport = (config = {}) =>
  new SparkPostTransport({ apiKey: 'sp-secret', retries: 0, ...config });
const message = (fields = {}) =>
  createMessage({
    from: { name: 'Shop', address: 'shop@example.com' },
    to: ['bob@example.com'],
    subject: 'Your order',
    content: { text: 'Shipped', html: '<p>Shipped</p>' },
    ...fields,
  });
const results = (id = 'sp-1', rejected = 0, accepted = 1) =>
  json({
    results: { total_rejected_recipients: rejected, total_accepted_recipients: accepted, id },
  });

test('SparkPost: a message is a transmission, with the raw key', async (t) => {
  const requests = stubFetch(t, () => results());
  const receipt = await transport({ campaignId: 'autumn', transactional: true }).send(
    message({
      to: ['bob@example.com', { name: 'Carol', address: 'carol@bücher.de' }],
      cc: 'dave@example.com',
      bcc: 'erin@example.com',
      replyTo: 'support@example.com',
      priority: 'high',
      tags: ['orders', 'eu'],
      metadata: { orderId: '42' },
      tracking: { opens: false, clicks: true },
      list: { unsubscribe: 'https://example.com/u', oneClick: true },
      scheduledAt: new Date('2026-10-18T09:00:00.250Z'),
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
  assert.deepStrictEqual(receipt, { successful: true, messageId: 'sp-1', provider: 'sparkpost' });
  const [request] = requests;
  assert.strictEqual(request.url, 'https://api.sparkpost.com/api/v1/transmissions');
  assert.strictEqual(request.headers.get('authorization'), 'sp-secret');
  assert.strictEqual(request.redirect, 'manual');
  const body = request.json;
  const headerTo = 'bob@example.com, Carol <carol@xn--bcher-kva.de>';
  const tags = ['orders', 'eu'];
  assert.deepStrictEqual(body.recipients, [
    { address: { email: 'bob@example.com', header_to: headerTo }, tags },
    { address: { email: 'carol@xn--bcher-kva.de', name: 'Carol', header_to: headerTo }, tags },
    { address: { email: 'dave@example.com', header_to: headerTo }, tags },
    { address: { email: 'erin@example.com', header_to: headerTo }, tags },
  ]);
  assert.deepStrictEqual(body.options, {
    open_tracking: false,
    click_tracking: true,
    transactional: true,
    start_time: '2026-10-18T09:00:00+00:00',
  });
  assert.strictEqual(body.campaign_id, 'autumn');
  assert.deepStrictEqual(body.metadata, { orderId: '42' });
  const { content } = body;
  assert.deepStrictEqual(content.from, { email: 'shop@example.com', name: 'Shop' });
  assert.strictEqual(content.subject, 'Your order');
  assert.strictEqual(content.text, 'Shipped');
  assert.strictEqual(content.html, '<p>Shipped</p>');
  assert.strictEqual(content.reply_to, 'support@example.com');
  assert.deepStrictEqual(content.headers, {
    CC: 'dave@example.com',
    'X-Priority': '1',
    'X-MSMail-Priority': 'High',
    Importance: 'High',
    'List-Unsubscribe': '<https://example.com/u>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  });
  assert.deepStrictEqual(content.attachments, [
    { type: 'text/plain', data: 'aGk=', name: 'r.txt' },
  ]);
  assert.deepStrictEqual(content.inline_images, [
    { type: 'image/png', data: 'AQ==', name: 'logo@example.com' },
  ]);
});

test('SparkPost: one recipient needs no header_to, a plain message no options', async (t) => {
  const requests = stubFetch(t, () => results());
  await transport().send(message({ content: { text: 'plain' } }));
  const body = requests[0].json;
  assert.deepStrictEqual(body.recipients, [{ address: { email: 'bob@example.com' } }]);
  assert.strictEqual(body.options, undefined);
  assert.strictEqual(body.content.headers, undefined);
  assert.strictEqual(body.content.html, undefined);
  assert.strictEqual(body.campaign_id, undefined);
});

test('SparkPost: the EU region and a base URL choose the host', async (t) => {
  const requests = stubFetch(t, () => results());
  await transport({ region: 'eu' }).send(message());
  await transport({ region: 'eu', baseUrl: 'http://127.0.0.1:9000' }).send(message());
  assert.strictEqual(requests[0].url, 'https://api.eu.sparkpost.com/api/v1/transmissions');
  assert.strictEqual(requests[1].url, 'http://127.0.0.1:9000/api/v1/transmissions');
});

test('SparkPost: rejected recipients are counted, or fail the receipt when none went', async (t) => {
  const answers = [results('sp-2', 1, 2), results('sp-3', 2, 0), json({ results: {} })];
  stubFetch(t, () => answers.shift());
  const partial = await transport().send(message());
  assert.strictEqual(partial.successful, true);
  assert.strictEqual(partial.rejectedRecipientCount, 1);
  const none = await transport().send(message());
  assert.strictEqual(none.successful, false);
  assert.strictEqual(none.retryable, false);
  assert.strictEqual(none.errors[0].category, 'rejected');
  assert.strictEqual(none.errors[0].code, 'sparkpost.recipients_rejected');
  const unknown = await transport().send(message());
  assert.strictEqual(unknown.deliveryUnknown, true);
});

test('SparkPost: an error code says what failed', async (t) => {
  const answers = [
    json(
      {
        errors: [
          {
            message: 'Message generation rejected',
            description: 'recipient address suppressed due to customer policy',
            code: '1902',
          },
        ],
      },
      400,
    ),
    json(
      { errors: [{ message: 'Unconfigured or unverified sending domain.', code: '7001' }] },
      400,
    ),
    json({ errors: [{ message: 'Exceed Sending Limit (daily)', code: '2102' }] }, 420),
    json({ errors: [{ message: 'Unauthorized.' }] }, 401),
  ];
  stubFetch(t, () => answers.shift());
  const suppressed = await transport().send(message());
  assert.strictEqual(
    suppressed.errorMessages[0],
    'SparkPost: Message generation rejected: recipient address suppressed due to customer policy',
  );
  assert.strictEqual(suppressed.errors[0].category, 'rejected');
  assert.strictEqual(suppressed.errors[0].code, 'sparkpost.1902');
  assert.strictEqual(suppressed.retryable, false);
  assert.strictEqual((await transport().send(message())).errors[0].category, 'configuration');
  const limited = await transport().send(message());
  assert.strictEqual(limited.errors[0].category, 'rate-limit');
  assert.strictEqual(limited.retryable, true);
  const auth = await transport().send(message());
  assert.strictEqual(auth.errors[0].category, 'auth');
  assert.strictEqual(auth.errorMessages[0], 'SparkPost: Unauthorized.');
});

test('SparkPost: more than ten tags are refused before a request', async (t) => {
  const requests = stubFetch(t, () => results());
  const tags = [];
  for (let i = 0; i < 11; i++) tags.push(`t${i}`);
  const receipt = await transport().send(message({ tags }));
  assert.match(receipt.errorMessages[0], /at most 10 tags/);
  assert.strictEqual(requests.length, 0);
});

test('SparkPost: sendRaw sends the message as email_rfc822 to its envelope', async (t) => {
  const requests = stubFetch(t, () => results('sp-raw'));
  const text = 'From: shop@example.com\r\nTo: bob@example.com\r\nSubject: Grüße\r\n\r\nHi\r\n';
  const receipt = await transport({ campaignId: 'raw' }).sendRaw({
    envelope: { from: 'shop@example.com', to: ['bob@example.com', 'erin@bücher.de'] },
    content: new TextEncoder().encode(text),
  });
  assert.strictEqual(receipt.messageId, 'sp-raw');
  assert.deepStrictEqual(requests[0].json, {
    recipients: [
      { address: { email: 'bob@example.com' } },
      { address: { email: 'erin@xn--bcher-kva.de' } },
    ],
    content: { email_rfc822: text },
    campaign_id: 'raw',
  });
  const latin1 = await transport().sendRaw({
    envelope: { from: 'shop@example.com', to: ['bob@example.com'] },
    content: new Uint8Array([...new TextEncoder().encode('Subject: x\r\n\r\n'), 0xe9, 13, 10]),
  });
  assert.strictEqual(latin1.successful, false);
  assert.strictEqual(latin1.errors[0].category, 'unsupported');
  assert.match(latin1.errorMessages[0], /only as UTF-8/);
  const invalid = await transport().sendRaw({
    envelope: { from: 'shop@example.com', to: [] },
    content: new TextEncoder().encode(text),
  });
  assert.strictEqual(invalid.errors[0].category, 'validation');
  assert.strictEqual(requests.length, 1);
});

test('SparkPost: sendMany sends concurrently, in order', async (t) => {
  let index = 0;
  const requests = stubFetch(t, () => results(`sp-${index++}`));
  const tags = [];
  for (let i = 0; i < 11; i++) tags.push(`t${i}`);
  const receipts = [];
  for await (const receipt of transport({ concurrency: 2 }).sendMany([
    message(),
    message({ tags }),
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

test('SparkPost: verify reads the account, the options are checked, the key never shows', async (t) => {
  const answers = [json({ results: {} }), json({ errors: [{ message: 'Unauthorized.' }] }, 401)];
  const requests = stubFetch(t, () => answers.shift());
  await transport({ region: 'eu' }).verify();
  assert.strictEqual(requests[0].url, 'https://api.eu.sparkpost.com/api/v1/account');
  assert.strictEqual(requests[0].headers.get('authorization'), 'sp-secret');
  await assert.rejects(transport().verify(), /SparkPost refused the credentials/);
  assert.throws(() => new SparkPostTransport({}), /needs apiKey/);
  assert.throws(() => transport({ region: 'asia' }), /region must be 'us' or 'eu'/);
  assert.throws(() => transport({ campaignId: 42 }), /campaignId must be a non-empty string/);
  assert.throws(() => transport({ transactional: 'yes' }), /transactional must be a boolean/);
  assert.throws(() => transport({ baseUrl: 'http://api.example.com' }), /baseUrl/);
  const made = transport();
  assert.ok(!JSON.stringify(made).includes('sp-secret'));
  assert.ok(!util.inspect(made, { depth: 5 }).includes('sp-secret'));
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

test('SparkPost: a 420 is retried within the send, as its classification says', async (t) => {
  // Before: the classification of an error reached the receipt alone, so a
  // retryable 420 was not retried within the send.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => t.mock.timers.reset());
  let calls = 0;
  stubFetch(t, () => {
    calls++;
    return calls < 3
      ? json({ errors: [{ message: 'Exceed Sending Limit', code: '2102' }] }, 420)
      : json({ results: { id: 'tx-1', total_accepted_recipients: 1 } });
  });
  const state = { receipt: undefined };
  const sending = transport({ retries: 2 }).send(message());
  sending.then((answer) => (state.receipt = answer), assert.fail);
  for (let i = 0; i < 100 && state.receipt === undefined; i++) {
    t.mock.timers.tick(1000);
    await new Promise((resolve) => process.nextTick(resolve));
    await Promise.resolve();
  }
  const receipt = await sending;
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
  assert.strictEqual(calls, 3);
});
