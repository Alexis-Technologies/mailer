// Not ported: tests of ./scaleway, ported from unemail's Scaleway driver,
// against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');
const { createMessage } = require('../../index.js');
const { ScalewayTransport } = require('../../src/scaleway/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const PROJECT = '11111111-2222-4333-8444-555555555555';
const transport = (config = {}) =>
  new ScalewayTransport({ secretKey: 'scw-secret', projectId: PROJECT, retries: 0, ...config });
const message = (fields = {}) =>
  createMessage({
    from: { name: 'Shop', address: 'shop@example.com' },
    to: ['bob@example.com'],
    subject: 'Your order',
    content: { text: 'Shipped', html: '<p>Shipped</p>' },
    ...fields,
  });
const created = (...ids) => json({ emails: ids.map((id) => ({ id, status: 'new' })) });

test('Scaleway: a message is the request of /emails, with the secret key', async (t) => {
  const requests = stubFetch(t, () => created('em-1', 'em-2', 'em-3', 'em-4'));
  const receipt = await transport().send(
    message({
      to: ['bob@example.com', { name: 'Carol', address: 'carol@bücher.de' }],
      cc: 'dave@example.com',
      bcc: 'erin@example.com',
      replyTo: ['support@example.com', { name: 'Desk', address: 'desk@example.com' }],
      priority: 'low',
      tags: ['orders'],
      metadata: { orderId: '42' },
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
  assert.deepStrictEqual(receipt, { successful: true, messageId: 'em-1', provider: 'scaleway' });
  const [request] = requests;
  assert.strictEqual(
    request.url,
    'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails',
  );
  assert.strictEqual(request.headers.get('x-auth-token'), 'scw-secret');
  assert.strictEqual(request.redirect, 'manual');
  assert.deepStrictEqual(request.json, {
    from: { email: 'shop@example.com', name: 'Shop' },
    to: [{ email: 'bob@example.com' }, { email: 'carol@xn--bcher-kva.de', name: 'Carol' }],
    subject: 'Your order',
    project_id: PROJECT,
    cc: [{ email: 'dave@example.com' }],
    bcc: [{ email: 'erin@example.com' }],
    text: 'Shipped',
    html: '<p>Shipped</p>',
    additional_headers: [
      { key: 'X-Priority', value: '5' },
      { key: 'X-MSMail-Priority', value: 'Low' },
      { key: 'Importance', value: 'Low' },
      { key: 'List-Unsubscribe', value: '<https://example.com/u>' },
      { key: 'Reply-To', value: 'support@example.com, Desk <desk@example.com>' },
      { key: 'X-Metadata-orderId', value: '42' },
    ],
    attachments: [{ name: 'r.txt', type: 'text/plain', content: 'aGk=' }],
  });
});

test('Scaleway: the region is a segment of the path, a plain message has no headers', async (t) => {
  const requests = stubFetch(t, () => created('em-1'));
  await transport({ region: 'nl-ams', baseUrl: 'http://localhost:9000' }).send(
    message({ content: { text: 'plain' } }),
  );
  assert.strictEqual(
    requests[0].url,
    'http://localhost:9000/transactional-email/v1alpha1/regions/nl-ams/emails',
  );
  for (const key of ['cc', 'bcc', 'html', 'additional_headers', 'attachments']) {
    assert.strictEqual(requests[0].json[key], undefined, key);
  }
});

test('Scaleway: an error type says what failed', async (t) => {
  const answers = [
    json(
      {
        type: 'invalid_arguments',
        message: 'invalid argument(s)',
        details: [
          { argument_name: 'from.email', reason: 'constraint' },
          { argument_name: 'subject' },
          { reason: 'unknown' },
          {},
        ],
      },
      400,
    ),
    json({ type: 'invalid_arguments', details: [{ argument_name: 'to' }] }, 400),
    json({ type: 'invalid_arguments', message: 'bad', details: [] }, 400),
    json({ type: 'quotas_exceeded', message: 'quota(s) exceeded for this resource' }, 403),
    json({ type: 'denied_authentication', message: 'invalid secret key' }, 401),
    json({ emails: [] }),
  ];
  stubFetch(t, () => answers.shift());
  const invalid = await transport().send(message());
  assert.strictEqual(
    invalid.errorMessages[0],
    'Scaleway: invalid argument(s): from.email constraint; subject; unknown',
  );
  assert.strictEqual(invalid.errors[0].category, 'validation');
  assert.strictEqual(invalid.errors[0].code, 'scaleway.invalid_arguments');
  assert.strictEqual(
    (await transport().send(message())).errorMessages[0],
    'Scaleway: invalid arguments: to',
  );
  assert.strictEqual((await transport().send(message())).errorMessages[0], 'Scaleway: bad');
  const quota = await transport().send(message());
  assert.strictEqual(quota.errors[0].category, 'configuration');
  assert.strictEqual(quota.retryable, false);
  const auth = await transport().send(message());
  assert.strictEqual(auth.errors[0].category, 'auth');
  assert.strictEqual(auth.errorMessages[0], 'Scaleway: invalid secret key');
  assert.strictEqual((await transport().send(message())).deliveryUnknown, true);
});

test('Scaleway: an inline part, a schedule and 2 MB are refused before a request', async (t) => {
  const requests = stubFetch(t, () => created('em-1'));
  const refusals = [
    [
      message({
        attachments: {
          filename: 'logo.png',
          contentType: 'image/png',
          inline: true,
          contentId: 'logo@example.com',
          content: new Uint8Array(1),
        },
      }),
      /cannot send an inline attachment/,
    ],
    [message({ scheduledAt: new Date() }), /Invalid scheduledAt: scaleway/],
    [
      message({
        attachments: {
          filename: 'big.pdf',
          contentType: 'application/pdf',
          inline: false,
          contentId: '',
          content: new Uint8Array(1600 * 1024),
        },
      }),
      /Scaleway takes at most 2097152/,
    ],
  ];
  for (const [refused, error] of refusals) {
    assert.match((await transport().send(refused)).errorMessages[0], error);
  }
  assert.strictEqual(requests.length, 0);
});

test('Scaleway: sendMany sends concurrently, in order', async (t) => {
  let index = 0;
  const requests = stubFetch(t, () => created(`em-${index++}`));
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

test('Scaleway: verify lists the domains, the options are checked, the key never shows', async (t) => {
  const answers = [
    json({ domains: [], total_count: 0 }),
    json({ type: 'denied_authentication' }, 401),
  ];
  const requests = stubFetch(t, () => answers.shift());
  await transport().verify();
  assert.strictEqual(
    requests[0].url,
    `https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/domains?project_id=${PROJECT}&page_size=1`,
  );
  assert.strictEqual(requests[0].headers.get('x-auth-token'), 'scw-secret');
  await assert.rejects(transport().verify(), /Scaleway refused the credentials/);
  assert.throws(() => new ScalewayTransport({ projectId: PROJECT }), /needs secretKey/);
  assert.throws(() => new ScalewayTransport({ secretKey: 'k' }), /needs projectId/);
  assert.throws(() => transport({ region: 'fr-par/../x' }), /region must be a Scaleway region/);
  assert.throws(() => transport({ region: 1 }), /region must be a Scaleway region/);
  assert.throws(() => transport({ baseUrl: 'http://api.example.com' }), /baseUrl/);
  const made = transport();
  assert.ok(!JSON.stringify(made).includes('scw-secret'));
  assert.ok(!util.inspect(made, { depth: 5 }).includes('scw-secret'));
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  await assert.rejects(made.send(message(), { signal: controller.signal }), /stop/);
});
