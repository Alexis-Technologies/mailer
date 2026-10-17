// Not ported: tests of ./azure, ported from unemail's Azure Communication
// Services driver, against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');
const { createMessage } = require('../../index.js');
const { AzureTransport } = require('../../src/azure/index.js');
const { toUuid } = require('../../src/internal/uuid.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const NOW = Date.parse('2026-10-17T12:00:00Z');
const KEY = Buffer.from('azure-access-key-secret').toString('base64');
const ENDPOINT = 'https://contoso.communication.azure.com';
const transport = (config = {}) =>
  new AzureTransport({
    connectionString: `endpoint=${ENDPOINT}/;accesskey=${KEY}`,
    retries: 0,
    now: () => NOW,
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
const accepted = (id = 'op-1') =>
  json({ id, status: 'Running' }, 202, {
    'operation-location': `${ENDPOINT}/emails/operations/${id}?api-version=2025-09-01`,
    'retry-after': '20',
  });

// The signature by Web Crypto, apart from the transport's node:crypto.
const expectedSignature = async (method, url, body, date) => {
  const subtle = globalThis.crypto.subtle;
  const encoder = new TextEncoder();
  const hash = Buffer.from(await subtle.digest('SHA-256', encoder.encode(body))).toString('base64');
  const parsed = new URL(url);
  const text = `${method}\n${parsed.pathname}${parsed.search}\n${date};${parsed.host};${hash}`;
  const key = await subtle.importKey(
    'raw',
    Buffer.from(KEY, 'base64'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = Buffer.from(await subtle.sign('HMAC', key, encoder.encode(text)));
  return {
    hash,
    authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature.toString('base64')}`,
  };
};

test('Azure: a message is the signed request of emails:send', async (t) => {
  const requests = stubFetch(t, () => accepted());
  const receipt = await transport().send(
    message({
      to: ['bob@example.com', { name: 'Carol', address: 'carol@bücher.de' }],
      cc: 'dave@example.com',
      bcc: 'erin@example.com',
      replyTo: { name: 'Desk', address: 'desk@example.com' },
      priority: 'high',
      tags: ['orders'],
      metadata: { orderId: '42' },
      tracking: { opens: false, clicks: false },
      list: { unsubscribe: 'https://example.com/u' },
      idempotencyKey: 'order-42',
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
  assert.deepStrictEqual(receipt, { successful: true, messageId: 'op-1', provider: 'azure' });
  const [request] = requests;
  assert.strictEqual(request.url, `${ENDPOINT}/emails:send?api-version=2025-09-01`);
  assert.strictEqual(request.redirect, 'manual');
  const date = new Date(NOW).toUTCString();
  const signed = await expectedSignature('POST', request.url, request.body, date);
  assert.strictEqual(request.headers.get('x-ms-date'), date);
  assert.strictEqual(request.headers.get('x-ms-content-sha256'), signed.hash);
  assert.strictEqual(request.headers.get('authorization'), signed.authorization);
  const key = toUuid('order-42');
  assert.strictEqual(request.headers.get('operation-id'), key);
  assert.strictEqual(request.headers.get('repeatability-request-id'), key);
  assert.strictEqual(request.headers.get('repeatability-first-sent'), date);
  assert.deepStrictEqual(request.json, {
    senderAddress: 'shop@example.com',
    recipients: {
      to: [
        { address: 'bob@example.com' },
        { address: 'carol@xn--bcher-kva.de', displayName: 'Carol' },
      ],
      cc: [{ address: 'dave@example.com' }],
      bcc: [{ address: 'erin@example.com' }],
    },
    content: { subject: 'Your order', plainText: 'Shipped', html: '<p>Shipped</p>' },
    replyTo: [{ address: 'desk@example.com', displayName: 'Desk' }],
    headers: {
      'X-Priority': '1',
      'X-MSMail-Priority': 'High',
      Importance: 'High',
      'List-Unsubscribe': '<https://example.com/u>',
      'X-Metadata-orderId': '42',
    },
    userEngagementTrackingDisabled: true,
    attachments: [
      { name: 'r.txt', contentType: 'text/plain', contentInBase64: 'aGk=' },
      {
        name: 'logo.png',
        contentType: 'image/png',
        contentInBase64: 'AQ==',
        contentId: 'logo@example.com',
      },
    ],
  });
});

test('Azure: a retry keeps the key and the first time, and is signed anew', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  let now = NOW;
  const answers = [json({ error: { code: 'ServiceUnavailable' } }, 504), accepted('op-2')];
  const requests = stubFetch(t, () => {
    const answer = answers.shift();
    now += 1000;
    return answer;
  });
  const receipt = await transport({ retries: 1, now: () => now }).send(message());
  assert.strictEqual(receipt.messageId, 'op-2');
  assert.strictEqual(requests.length, 2);
  const key = toUuid('gen-1');
  for (const request of requests) {
    assert.strictEqual(request.headers.get('repeatability-request-id'), key);
    assert.strictEqual(
      request.headers.get('repeatability-first-sent'),
      new Date(NOW).toUTCString(),
    );
  }
  assert.notStrictEqual(requests[0].headers.get('x-ms-date'), requests[1].headers.get('x-ms-date'));
  const signed = await expectedSignature(
    'POST',
    requests[1].url,
    requests[1].body,
    requests[1].headers.get('x-ms-date'),
  );
  assert.strictEqual(requests[1].headers.get('authorization'), signed.authorization);
});

test('Azure: a repeat Azure took before is of unknown delivery', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const answers = [
    json({ error: { code: 'Conflict', message: 'The request is still running.' } }, 409),
    json({ error: { code: 'ServiceUnavailable' } }, 504),
    json({ error: { code: 'PreconditionFailed', message: 'Outside the window.' } }, 412),
    json({ error: { code: 'PreconditionFailed', message: 'Clock skew.' } }, 412),
  ];
  stubFetch(t, () => answers.shift());
  const running = await transport().send(message());
  assert.strictEqual(running.successful, false);
  assert.strictEqual(running.deliveryUnknown, true);
  assert.strictEqual(running.retryable, false);
  assert.match(running.errorMessages[0], /still running.*a repeat of a request Azure took before/);
  const late = await transport({ retries: 1 }).send(message());
  assert.strictEqual(late.deliveryUnknown, true);
  const skewed = await transport().send(message());
  assert.strictEqual(skewed.deliveryUnknown, undefined);
  assert.strictEqual(skewed.errors[0].code, 'azure.PreconditionFailed');
});

test('Azure: an error code says what failed, a failed operation fails the receipt', async (t) => {
  const answers = [
    json({ error: { code: 'Unauthorized', message: 'Denied by the authentication policy.' } }, 401),
    json({ error: { code: 'TooManyRequests', message: 'Slow down.' } }, 400),
    json({ error: { code: 'InvalidSenderDomain', message: 'Domain not linked.' } }, 400),
    json({ id: 'op-3', status: 'Failed', error: { code: 'Blocked', message: 'Blocked.' } }, 202),
    json(null, 202, { 'operation-location': 'x' }),
    json({ id: 'op-4', status: 'Canceled' }, 202),
    json({ error: {} }, 500),
  ];
  stubFetch(t, () => answers.shift());
  const auth = await transport().send(message());
  assert.strictEqual(
    auth.errorMessages[0],
    'Azure Communication Services: Denied by the authentication policy.',
  );
  assert.strictEqual(auth.errors[0].category, 'auth');
  assert.strictEqual(auth.errors[0].code, 'azure.Unauthorized');
  const throttled = await transport().send(message());
  assert.strictEqual(throttled.errors[0].category, 'rate-limit');
  assert.strictEqual(throttled.retryable, true);
  assert.strictEqual((await transport().send(message())).errors[0].category, 'validation');
  const failed = await transport().send(message());
  assert.strictEqual(failed.errorMessages[0], 'Azure Communication Services: Blocked.');
  assert.strictEqual(failed.errors[0].code, 'azure.Blocked');
  assert.strictEqual(failed.retryable, false);
  // Without an id in the body, the receipt has the one sent.
  assert.strictEqual((await transport().send(message())).messageId, toUuid('gen-1'));
  const canceled = await transport().send(message());
  assert.strictEqual(canceled.errorMessages[0], 'Azure Communication Services: Canceled');
  assert.strictEqual(canceled.errors[0].code, 'rejected');
  const server = await transport().send(message());
  assert.strictEqual(server.errors[0].category, 'server-error');
  assert.strictEqual(server.retryable, true);
});

test('Azure: tracking, size and a schedule are refused before a request', async (t) => {
  const requests = stubFetch(t, () => accepted());
  const refusals = [
    [message({ tracking: { opens: true, clicks: false } }), /on or off together/],
    [message({ scheduledAt: new Date(NOW + 1000) }), /Unsupported scheduledAt: azure/],
    [
      message({
        attachments: {
          filename: 'big.bin',
          contentType: 'application/octet-stream',
          inline: false,
          contentId: '',
          content: new Uint8Array(8 * 1024 * 1024),
        },
      }),
      /Azure takes at most 10485760/,
    ],
  ];
  for (const [refused, error] of refusals) {
    const receipt = await transport().send(refused);
    assert.match(receipt.errorMessages[0], error);
    assert.strictEqual(receipt.errors[0].category, 'unsupported');
    assert.strictEqual(receipt.retryable, false);
  }
  assert.strictEqual(requests.length, 0);
});

test('Azure: tracking follows the message, then the configuration', async (t) => {
  const requests = stubFetch(t, () => accepted());
  const disabled = transport({ userEngagementTrackingDisabled: true });
  await disabled.send(message());
  await disabled.send(message({ tracking: { clicks: true } }));
  await disabled.send(message({ tracking: {} }));
  await transport().send(message());
  assert.deepStrictEqual(
    requests.map((request) => request.json.userEngagementTrackingDisabled),
    [true, false, true, undefined],
  );
});

test('Azure: sendMany sends concurrently, in order', async (t) => {
  let index = 0;
  const requests = stubFetch(t, () => accepted(`op-${index++}`));
  const receipts = [];
  for await (const receipt of transport({ concurrency: 2 }).sendMany([
    message(),
    message({ scheduledAt: new Date(NOW + 1000) }),
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

test('Azure: verify reads an operation that does not exist, signed', async (t) => {
  const answers = [
    json({ error: { code: 'NotFound' } }, 404),
    json({ id: 'x', status: 'Succeeded' }),
    json({ error: { code: 'Unauthorized' } }, 401),
  ];
  const requests = stubFetch(t, () => answers.shift());
  const made = transport({ connectionString: undefined, endpoint: `${ENDPOINT}/`, accessKey: KEY });
  await made.verify();
  const [request] = requests;
  assert.strictEqual(
    request.url,
    `${ENDPOINT}/emails/operations/00000000-0000-0000-0000-000000000000?api-version=2025-09-01`,
  );
  const date = new Date(NOW).toUTCString();
  const signed = await expectedSignature('GET', request.url, '', date);
  assert.strictEqual(request.headers.get('authorization'), signed.authorization);
  await made.verify();
  await assert.rejects(made.verify(), /Azure Communication Services refused the credentials/);
});

test('Azure: the credentials are checked, never read from the environment, never shown', async (t) => {
  // unemail read the connection string from here when none was given.
  process.env.COMMUNICATION_SERVICES_CONNECTION_STRING = `endpoint=${ENDPOINT};accesskey=${KEY}`;
  t.after(() => delete process.env.COMMUNICATION_SERVICES_CONNECTION_STRING);
  assert.throws(() => new AzureTransport({}), /needs connectionString, or endpoint and accessKey/);
  assert.throws(() => transport({ connectionString: 'accesskey=abc' }), /connectionString must be/);
  assert.throws(() => transport({ connectionString: 'endpoint' }), /connectionString must be/);
  assert.throws(() => transport({ connectionString: 42 }), /connectionString must be/);
  assert.throws(
    () => transport({ connectionString: `endpoint=${ENDPOINT};accesskey=not base64!` }),
    /accessKey must be the base64 key/,
  );
  assert.throws(
    () => transport({ connectionString: `endpoint=http://contoso.example.com;accesskey=${KEY}` }),
    /`endpoint` must use HTTPS/,
  );
  assert.throws(() => transport({ apiVersion: '2025-09-01&x=1' }), /apiVersion must be a date/);
  assert.throws(
    () => transport({ userEngagementTrackingDisabled: 'yes' }),
    /userEngagementTrackingDisabled must be a boolean/,
  );
  const local = transport({
    connectionString: ` endpoint = http://127.0.0.1:9000 ; ; accesskey=${KEY};`,
    apiVersion: '2023-01-15-preview',
  });
  assert.strictEqual(local.config.endpoint, 'http://127.0.0.1:9000');
  const made = transport();
  assert.ok(!JSON.stringify(made).includes(KEY));
  assert.ok(!util.inspect(made, { depth: 5 }).includes(KEY));
  const controller = new AbortController();
  controller.abort(new Error('stop'));
  await assert.rejects(made.send(message(), { signal: controller.signal }), /stop/);
});
