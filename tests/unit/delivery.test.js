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
    () =>
      new SesTransport({
        ...options,
        authentication: { type: 'credentials', accessKeyId: 'a', secretAccessKey: 'b' },
      }),
  ],
  ['Resend', 200, () => new ResendTransport({ ...options, apiKey: 'key' })],
  ['SendGrid', 202, () => new SendGridTransport({ ...options, apiKey: 'key' })],
  [
    'Mailgun',
    200,
    () => new MailgunTransport({ ...options, apiKey: 'key', domain: 'mg.example.com' }),
  ],
  ['Mailtrap', 200, () => new MailtrapTransport({ ...options, apiToken: 'token' })],
  ['Maileroo', 200, () => new MailerooTransport({ ...options, apiKey: 'key' })],
  ['Lettermint', 200, () => new LettermintTransport({ ...options, apiToken: 'token' })],
  ['Plunk', 200, () => new PlunkTransport({ ...options, apiKey: 'key' })],
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
