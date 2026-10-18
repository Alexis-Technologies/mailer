// Not ported: tests of ./smtp2go, ported from unemail's SMTP2GO driver,
// against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');
const { createMessage } = require('../../index.js');
const { Smtp2goTransport } = require('../../src/smtp2go/index.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const NOW = Date.parse('2026-10-17T12:00:00Z');
const transport = (config = {}) =>
  new Smtp2goTransport({ apiKey: 'api-secret', retries: 0, now: () => NOW, ...config });
const message = (fields = {}) =>
  createMessage({
    from: { name: 'Shop', address: 'shop@example.com' },
    to: ['bob@example.com'],
    subject: 'Your order',
    content: { text: 'Shipped', html: '<p>Shipped</p>' },
    ...fields,
  });
const sent = (data = { email_id: 'em-1' }) =>
  json({ request_id: 'req-1', data: { succeeded: 1, failed: 0, failures: [], ...data } });

test('SMTP2GO: a message is the request of /v3/email/send, with the key', async (t) => {
  const requests = stubFetch(t, () => sent({ email_id: 'em-1', schedule_id: 'sc-1' }));
  const receipt = await transport({ region: 'eu', fastAccept: true }).send(
    message({
      to: ['bob@example.com', { name: 'Carol', address: 'carol@bücher.de' }],
      cc: 'dave@example.com',
      bcc: 'erin@example.com',
      replyTo: ['support@example.com', { name: 'Desk', address: 'desk@example.com' }],
      priority: 'high',
      tags: ['orders'],
      metadata: { orderId: '42' },
      tracking: { opens: true },
      list: { unsubscribe: 'https://example.com/u' },
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
  assert.deepStrictEqual(receipt, { successful: true, messageId: 'em-1', provider: 'smtp2go' });
  const [request] = requests;
  assert.strictEqual(request.url, 'https://eu-api.smtp2go.com/v3/email/send');
  assert.strictEqual(request.headers.get('x-smtp2go-api-key'), 'api-secret');
  assert.strictEqual(request.redirect, 'manual');
  assert.deepStrictEqual(request.json, {
    sender: 'Shop <shop@example.com>',
    to: ['bob@example.com', 'Carol <carol@xn--bcher-kva.de>'],
    cc: ['dave@example.com'],
    bcc: ['erin@example.com'],
    subject: 'Your order',
    text_body: 'Shipped',
    html_body: '<p>Shipped</p>',
    custom_headers: [
      { header: 'X-Priority', value: '1' },
      { header: 'X-MSMail-Priority', value: 'High' },
      { header: 'Importance', value: 'High' },
      { header: 'List-Unsubscribe', value: '<https://example.com/u>' },
      { header: 'Reply-To', value: 'support@example.com, Desk <desk@example.com>' },
      { header: 'X-Metadata-orderId', value: '42' },
    ],
    attachments: [{ fileblob: 'aGk=', mimetype: 'text/plain', filename: 'r.txt' }],
    inlines: [{ fileblob: 'AQ==', mimetype: 'image/png', filename: 'logo@example.com' }],
    schedule: '2026-10-17 13:00:00 +0000',
    fastaccept: true,
  });
});

test('SMTP2GO: the region chooses the host, the global one without it', async (t) => {
  const requests = stubFetch(t, () => sent());
  await transport().send(message({ content: { text: 'plain' } }));
  await transport({ region: 'au' }).send(message());
  await transport({ region: 'us', baseUrl: 'http://localhost:9000' }).send(message());
  assert.deepStrictEqual(
    requests.map((request) => request.url),
    [
      'https://api.smtp2go.com/v3/email/send',
      'https://au-api.smtp2go.com/v3/email/send',
      'http://localhost:9000/v3/email/send',
    ],
  );
  const body = requests[0].json;
  for (const key of ['cc', 'bcc', 'html_body', 'custom_headers', 'schedule', 'fastaccept']) {
    assert.strictEqual(body[key], undefined, key);
  }
});

test('SMTP2GO: a 200 with failures fails the receipt, one without an id is unknown', async (t) => {
  const answers = [
    sent({ succeeded: 0, failed: 1, failures: ['Sender domain not verified'] }),
    sent({ succeeded: 0, failed: 1, failures: [{ reason: 'blocked' }] }),
    sent({ succeeded: 0, failed: 1, failures: [] }),
    sent({ schedule_id: 'sc-2', email_id: undefined }),
    json({ request_id: 'req-2', data: {} }),
  ];
  stubFetch(t, () => answers.shift());
  const failed = await transport().send(message());
  assert.strictEqual(failed.successful, false);
  assert.strictEqual(failed.errorMessages[0], 'SMTP2GO: Sender domain not verified');
  assert.strictEqual(failed.errors[0].category, 'rejected');
  assert.strictEqual(failed.errors[0].code, 'smtp2go.failed');
  assert.strictEqual(failed.retryable, false);
  assert.strictEqual(
    (await transport().send(message())).errorMessages[0],
    'SMTP2GO: {"reason":"blocked"}',
  );
  assert.strictEqual(
    (await transport().send(message())).errorMessages[0],
    'SMTP2GO: the message failed.',
  );
  assert.strictEqual((await transport().send(message())).messageId, 'sc-2');
  assert.strictEqual((await transport().send(message())).deliveryUnknown, true);
});

test('SMTP2GO: an error under data says what failed, a refused key is auth', async (t) => {
  const answers = [
    json(
      {
        request_id: 'r',
        data: {
          error_code: 'E_ApiResponseCodes.API_KEY_NOT_FOUND',
          error: 'The API key was not found',
        },
      },
      400,
    ),
    json(
      {
        request_id: 'r',
        data: {
          error_code: 'E_ApiResponseCodes.NON_VALIDATING_IN_PAYLOAD',
          error: 'An email address is invalid',
        },
      },
      400,
    ),
    json({ request_id: 'r', data: {} }, 500),
  ];
  stubFetch(t, () => answers.shift());
  const auth = await transport().send(message());
  assert.strictEqual(auth.errorMessages[0], 'SMTP2GO: The API key was not found');
  assert.strictEqual(auth.errors[0].category, 'auth');
  assert.strictEqual(auth.errors[0].code, 'smtp2go.API_KEY_NOT_FOUND');
  const invalid = await transport().send(message());
  assert.strictEqual(invalid.errors[0].category, 'validation');
  assert.strictEqual(invalid.errors[0].code, 'smtp2go.NON_VALIDATING_IN_PAYLOAD');
  const server = await transport().send(message());
  assert.strictEqual(server.errors[0].category, 'server-error');
  assert.strictEqual(server.errors[0].code, 'http.500');
});

test('SMTP2GO: its limits are refused before a request', async (t) => {
  const requests = stubFetch(t, () => sent());
  const many = (count) => {
    const list = [];
    for (let i = 0; i < count; i++) list.push(`r${i}@example.com`);
    return list;
  };
  const refusals = [
    [message({ to: many(101) }), /at most 100 to recipients/],
    [message({ cc: many(101) }), /at most 100 cc recipients/],
    [message({ bcc: many(101) }), /at most 100 bcc recipients/],
    [message({ scheduledAt: new Date(NOW + 73 * 3600_000) }), /3 days ahead/],
  ];
  for (const [refused, error] of refusals) {
    assert.match((await transport().send(refused)).errorMessages[0], error);
  }
  assert.strictEqual(requests.length, 0);
});

test('SMTP2GO: sendMany sends concurrently, in order', async (t) => {
  let index = 0;
  const requests = stubFetch(t, () => sent({ email_id: `em-${index++}` }));
  const receipts = [];
  for await (const receipt of transport({ concurrency: 2 }).sendMany([
    message(),
    message({ scheduledAt: new Date(NOW + 73 * 3600_000) }),
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

test('SMTP2GO: verify reads the summary, a key that may not is verified too', async (t) => {
  const answers = [
    json({ request_id: 'r', data: { cycle_used: 1 } }),
    json(
      {
        request_id: 'r',
        data: {
          error_code: 'E_ApiResponseCodes.ENDPOINT_PERMISSION_DENIED',
          error: 'You do not have permission to access this API endpoint',
        },
      },
      400,
    ),
    json({ request_id: 'r', data: { error_code: 'E_ApiResponseCodes.API_KEY_NOT_FOUND' } }, 400),
    json({}, 401),
  ];
  const requests = stubFetch(t, () => answers.shift());
  await transport({ region: 'eu' }).verify();
  assert.strictEqual(requests[0].url, 'https://eu-api.smtp2go.com/v3/stats/email_summary');
  assert.strictEqual(requests[0].method, 'POST');
  assert.deepStrictEqual(requests[0].json, {});
  assert.strictEqual(requests[0].headers.get('x-smtp2go-api-key'), 'api-secret');
  await transport().verify();
  await assert.rejects(transport().verify(), /SMTP2GO answered the check with HTTP 400/);
  await assert.rejects(transport().verify(), /SMTP2GO refused the credentials/);
});

test('SMTP2GO: the options are checked, and the key never shows', async () => {
  assert.throws(() => new Smtp2goTransport({}), /needs apiKey/);
  assert.throws(() => transport({ region: 'asia' }), /region must be 'us', 'eu' or 'au'/);
  assert.throws(() => transport({ fastAccept: 1 }), /fastAccept must be a boolean/);
  assert.throws(() => transport({ baseUrl: 'http://api.example.com' }), /baseUrl/);
  const made = transport();
  assert.ok(!JSON.stringify(made).includes('api-secret'));
  assert.ok(!util.inspect(made, { depth: 5 }).includes('api-secret'));
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  await assert.rejects(made.send(message(), { signal: controller.signal }), /stop/);
});
