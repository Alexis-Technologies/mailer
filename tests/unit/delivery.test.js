// A provider that answered 2xx took the request: whatever fails after that,
// such as reading the body, must not send the message again.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { LettermintTransport } = require('../../src/lettermint/index.js');
const { MailerooTransport } = require('../../src/maileroo/index.js');
const { MailgunTransport } = require('../../src/mailgun/index.js');
const { MailtrapTransport } = require('../../src/mailtrap/index.js');
const { PlunkTransport } = require('../../src/plunk/index.js');
const { ResendTransport } = require('../../src/resend/index.js');
const { SendGridTransport } = require('../../src/sendgrid/index.js');
const { SesTransport } = require('../../src/ses/index.js');
const { JmapTransport } = require('../../src/jmap/index.js');

const message = () =>
  createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Hello',
    content: { text: 'Hi' },
  });

const options = { retries: 3 };
const providers = [
  [
    'SES',
    200,
    (extra) =>
      new SesTransport({
        ...options,
        ...extra,
        authentication: { type: 'credentials', accessKeyId: 'a', secretAccessKey: 'b' },
      }),
  ],
  ['Resend', 200, (extra) => new ResendTransport({ ...options, ...extra, apiKey: 'key' })],
  ['SendGrid', 202, (extra) => new SendGridTransport({ ...options, ...extra, apiKey: 'key' })],
  [
    'Mailgun',
    200,
    (extra) =>
      new MailgunTransport({ ...options, ...extra, apiKey: 'key', domain: 'mg.example.com' }),
  ],
  ['Mailtrap', 200, (extra) => new MailtrapTransport({ ...options, ...extra, apiToken: 'token' })],
  ['Maileroo', 200, (extra) => new MailerooTransport({ ...options, ...extra, apiKey: 'key' })],
  [
    'Lettermint',
    200,
    (extra) => new LettermintTransport({ ...options, ...extra, apiToken: 'token' }),
  ],
  ['Plunk', 200, (extra) => new PlunkTransport({ ...options, ...extra, apiKey: 'key' })],
];

// A 2xx whose body cannot be read: the connection broke after the headers.
const unreadable = (status) => {
  const response = new Response(null, { status });
  const broken = () => Promise.reject(new Error('Connection reset while reading the body.'));
  Object.defineProperty(response, 'text', { value: broken });
  Object.defineProperty(response, 'json', { value: broken });
  return response;
};

test('Delivery: a 2xx with an unreadable body is sent once, of unknown delivery', async (t) => {
  for (const [name, status, create] of providers) {
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      requests++;
      return unreadable(status);
    });
    const receipt = await create().send(message());
    t.mock.restoreAll();
    assert.strictEqual(requests, 1, name);
    assert.strictEqual(receipt.successful, false, name);
    assert.strictEqual(receipt.deliveryUnknown, true, name);
    assert.strictEqual(receipt.retryable, false, name);
  }
});

test('Delivery: Plunk refusing in a 200 is sent once, a definite failure', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return Response.json({ success: false, message: 'Sender not verified' });
  });
  const receipt = await new PlunkTransport({ ...options, apiKey: 'key' }).send(message());
  assert.strictEqual(requests, 1);
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.deliveryUnknown, undefined);
  assert.strictEqual(receipt.retryable, false);
  assert.match(receipt.errorMessages[0], /Sender not verified/);
});

// A 2xx whose body never ends, until the signal of the request aborts.
const stalled = (status, signal) => {
  const response = new Response(null, { status });
  const hang = () =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  Object.defineProperty(response, 'text', { value: hang });
  Object.defineProperty(response, 'json', { value: hang });
  return response;
};

test(
  'Delivery: the timeout covers a body that never ends, of unknown delivery',
  { timeout: 5000 },
  async (t) => {
    for (const [name, status, create] of providers) {
      t.mock.method(globalThis, 'fetch', async (_url, init) => stalled(status, init.signal));
      const transport = create({ timeout: 20 });
      const started = performance.now();
      const receipt = await transport.send(message());
      t.mock.restoreAll();
      assert.ok(performance.now() - started < 1000, name);
      assert.strictEqual(receipt.successful, false, name);
      assert.strictEqual(receipt.deliveryUnknown, true, name);
    }
  },
);

test('Delivery: a timeout of 0 or Infinity sets none, a bad one is refused', async (t) => {
  for (const [name, , create] of providers) {
    for (const timeout of [0, Infinity]) {
      t.mock.method(globalThis, 'fetch', async (_url, init) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify({ aborted: init.signal.aborted }), { status: 400 });
      });
      const receipt = await create({ timeout, retries: 0 }).send(message());
      t.mock.restoreAll();
      assert.strictEqual(receipt.errors[0].statusCode, 400, `${name} ${timeout}`);
    }
    assert.throws(() => create({ timeout: -1 }), RangeError, name);
    assert.throws(() => create({ retries: 1.5 }), RangeError, name);
  }
});

test(
  'Delivery: a Retry-After of two minutes is not waited for but returned',
  { timeout: 5000 },
  async (t) => {
    for (const [name, , create] of providers) {
      let requests = 0;
      t.mock.method(globalThis, 'fetch', async () => {
        requests++;
        return new Response('busy', { status: 503, headers: { 'Retry-After': '120' } });
      });
      const receipt = await create().send(message());
      t.mock.restoreAll();
      assert.strictEqual(requests, 1, name);
      assert.strictEqual(receipt.errors[0].retryAfterMilliseconds, 120_000, name);
    }
  },
);

test('Delivery: a redirect is not followed, nor retried', async (t) => {
  for (const [name, , create] of providers) {
    const redirects = [];
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      redirects.push(init.redirect);
      return new Response(null, { status: 307, headers: { Location: 'https://evil.example/' } });
    });
    const receipt = await create().send(message());
    t.mock.restoreAll();
    assert.deepStrictEqual(redirects, ['manual'], name);
    assert.strictEqual(receipt.successful, false, name);
    assert.strictEqual(receipt.errors[0].statusCode, 307, name);
  }
});

test('Delivery: a provider refuses to send its credentials over plain HTTP', () => {
  const insecure = 'http://api.example.com';
  const configs = [
    () => new ResendTransport({ apiKey: 'key', baseUrl: insecure }),
    () => new SendGridTransport({ apiKey: 'key', baseUrl: insecure }),
    () => new MailgunTransport({ apiKey: 'key', domain: 'mg.example.com', baseUrl: insecure }),
    () => new MailtrapTransport({ apiToken: 'token', sendBaseUrl: insecure }),
    () => new MailerooTransport({ apiKey: 'key', baseUrl: insecure }),
    () => new LettermintTransport({ apiToken: 'token', baseUrl: insecure }),
    () => new PlunkTransport({ apiKey: 'key', baseUrl: insecure }),
    () => new JmapTransport({ sessionUrl: `${insecure}/session`, bearerToken: 'token' }),
  ];
  for (const create of configs) assert.throws(create, TypeError);
  const local = new ResendTransport({ apiKey: 'key', baseUrl: 'http://localhost:8080' });
  assert.strictEqual(local.config.baseUrl, 'http://localhost:8080');
});
