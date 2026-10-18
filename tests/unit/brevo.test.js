// Not ported: tests of ./brevo, ported from unemail's and sently's Brevo
// drivers, against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');
const { createMessage } = require('../../index.js');
const { BrevoTransport } = require('../../src/brevo/index.js');
const { toUuid } = require('../../src/internal/uuid.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const transport = (config = {}) =>
  new BrevoTransport({
    apiKey: 'xkeysib-secret',
    retries: 0,
    generateId: () => 'gen-1',
    ...config,
  });
const message = (fields = {}) =>
  createMessage({
    from: { name: 'Shop', address: 'shop@example.com' },
    to: ['bob@example.com', { name: 'Carol', address: 'carol@bücher.de' }],
    subject: 'Your order',
    content: { text: 'Shipped', html: '<p>Shipped</p>' },
    ...fields,
  });
const created = (id = '<1@smtp-relay.mailin.fr>') => json({ messageId: id }, 201);

test('Brevo: a message is the request of /v3/smtp/email, with the key', async (t) => {
  const requests = stubFetch(t, () => created());
  const scheduledAt = new Date('2026-10-18T09:00:00Z');
  const receipt = await transport({ sandbox: true }).send(
    message({
      cc: 'dave@example.com',
      bcc: 'erin@example.com',
      replyTo: 'support@example.com',
      priority: 'low',
      tags: ['orders', 'eu'],
      metadata: { orderId: '42' },
      idempotencyKey: 'order-42',
      scheduledAt,
      list: { unsubscribe: 'https://example.com/u' },
      attachments: {
        filename: 'r.txt',
        contentType: 'text/plain',
        inline: false,
        contentId: '',
        content: new TextEncoder().encode('hi'),
      },
    }),
  );
  assert.deepStrictEqual(receipt, {
    successful: true,
    messageId: '<1@smtp-relay.mailin.fr>',
    provider: 'brevo',
  });
  const [request] = requests;
  assert.strictEqual(request.url, 'https://api.brevo.com/v3/smtp/email');
  assert.strictEqual(request.headers.get('api-key'), 'xkeysib-secret');
  assert.strictEqual(request.redirect, 'manual');
  const body = request.json;
  assert.deepStrictEqual(body.sender, { email: 'shop@example.com', name: 'Shop' });
  assert.deepStrictEqual(body.to, [
    { email: 'bob@example.com' },
    { email: 'carol@xn--bcher-kva.de', name: 'Carol' },
  ]);
  assert.deepStrictEqual(body.cc, [{ email: 'dave@example.com' }]);
  assert.deepStrictEqual(body.bcc, [{ email: 'erin@example.com' }]);
  assert.deepStrictEqual(body.replyTo, { email: 'support@example.com' });
  assert.strictEqual(body.htmlContent, '<p>Shipped</p>');
  assert.strictEqual(body.textContent, 'Shipped');
  assert.deepStrictEqual(body.tags, ['orders', 'eu']);
  assert.strictEqual(body.scheduledAt, '2026-10-18T09:00:00.000Z');
  assert.deepStrictEqual(body.attachment, [{ name: 'r.txt', content: 'aGk=' }]);
  assert.strictEqual(body.headers['X-Priority'], '5');
  assert.strictEqual(body.headers['List-Unsubscribe'], '<https://example.com/u>');
  assert.strictEqual(body.headers['X-Mailin-custom'], '{"orderId":"42"}');
  assert.strictEqual(body.headers['X-Sib-Sandbox'], 'drop');
  // The key of the message, as the UUID Brevo takes, among its headers.
  assert.strictEqual(body.headers.idempotencyKey, toUuid('order-42'));
});

test('Brevo: a message without a key gets one, the same through retries', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const answers = [json({ code: 'internal', message: 'busy' }, 504), created('<2@x>')];
  const requests = stubFetch(t, () => answers.shift());
  const receipt = await transport({ retries: 1 }).send(message());
  assert.strictEqual(receipt.messageId, '<2@x>');
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(requests[0].json.headers.idempotencyKey, toUuid('gen-1'));
  assert.strictEqual(requests[1].json.headers.idempotencyKey, toUuid('gen-1'));
});

test('Brevo: a repeated key is a delivery already made, not a failure to retry', async (t) => {
  stubFetch(t, () =>
    json({ code: 'duplicate_parameter', message: 'idempotencyKey already used' }, 400),
  );
  const receipt = await transport().send(message({ idempotencyKey: 'order-42' }));
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.deliveryUnknown, true);
  assert.strictEqual(receipt.retryable, false);
  assert.strictEqual(receipt.errors[0].code, 'brevo.duplicate_parameter');
});

test('Brevo: an error code says what failed', async (t) => {
  const answers = [
    json({ code: 'unauthorized', message: 'Key not found' }, 401),
    json({ code: 'not_enough_credits', message: 'No credits' }, 402),
    json({ code: 'invalid_parameter', message: 'email is not valid in to' }, 400),
    json({ messageIds: ['<3@x>'] }, 201),
    json({}, 201),
  ];
  stubFetch(t, () => answers.shift());
  const auth = await transport().send(message());
  assert.strictEqual(auth.errors[0].category, 'auth');
  assert.strictEqual(auth.errors[0].code, 'brevo.unauthorized');
  assert.strictEqual((await transport().send(message())).errors[0].category, 'configuration');
  const invalid = await transport().send(message());
  assert.strictEqual(invalid.errors[0].category, 'validation');
  assert.match(invalid.errorMessages[0], /^Brevo: email is not valid in to/);
  assert.strictEqual((await transport().send(message())).messageId, '<3@x>');
  const empty = await transport().send(message());
  assert.strictEqual(empty.deliveryUnknown, true);
});

test('Brevo: a second reply-to and an inline part are refused, not dropped', async (t) => {
  const requests = stubFetch(t, () => created());
  const replies = await transport().send(message({ replyTo: ['a@example.com', 'b@example.com'] }));
  assert.match(replies.errorMessages[0], /one reply-to address/);
  const inline = await transport().send(
    message({
      attachments: {
        filename: 'logo.png',
        contentType: 'image/png',
        inline: true,
        contentId: 'logo@example.com',
        content: new Uint8Array(1),
      },
    }),
  );
  assert.match(inline.errorMessages[0], /cannot send an inline attachment/);
  assert.strictEqual(requests.length, 0);
});

test('Brevo: sendMany sends concurrently, in order', async (t) => {
  let index = 0;
  const requests = stubFetch(t, () => created(`<${index++}@x>`));
  const receipts = [];
  for await (const receipt of transport({ concurrency: 2 }).sendMany([
    message(),
    message({ replyTo: ['a@example.com', 'b@example.com'] }),
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

test('Brevo: verify reads the account, the options are checked, the key never shows', async (t) => {
  const answers = [json({ email: 'me@example.com' }), json({ code: 'unauthorized' }, 401)];
  const requests = stubFetch(t, () => answers.shift());
  await transport().verify();
  assert.strictEqual(requests[0].url, 'https://api.brevo.com/v3/account');
  await assert.rejects(transport().verify(), /Brevo refused the credentials/);
  assert.throws(() => new BrevoTransport({}), /needs apiKey/);
  assert.throws(() => transport({ sandbox: 1 }), /sandbox must be a boolean/);
  assert.throws(() => transport({ concurrency: 0 }), /concurrency/);
  const made = transport();
  assert.ok(!JSON.stringify(made).includes('xkeysib-secret'));
  assert.ok(!util.inspect(made, { depth: 5 }).includes('xkeysib-secret'));
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  await assert.rejects(made.send(message(), { signal: controller.signal }), /stop/);
});

test('UUID: a key becomes a stable version 4 UUID, a UUID stays as it is', () => {
  const uuid = toUuid('order-42');
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.strictEqual(toUuid('order-42'), uuid);
  assert.notStrictEqual(toUuid('order-43'), uuid);
  assert.strictEqual(
    toUuid('3F2504E0-4F89-11D3-9A0C-0305E82C3301'),
    '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
  );
});
