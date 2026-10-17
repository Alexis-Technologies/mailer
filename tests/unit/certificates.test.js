// Not ported: a TLS certificate refused in the handshake, as the fetch of
// Node, Bun and Deno report it, on every HTTP transport.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage, classifyReceiptError } = require('../../index.js');
const { isUnsentRequestError } = require('../../src/internal/unsent.js');
const { AzureTransport } = require('../../src/azure/index.js');
const { BrevoTransport } = require('../../src/brevo/index.js');
const { CloudflareTransport } = require('../../src/cloudflare/index.js');
const { JmapTransport } = require('../../src/jmap/index.js');
const { LettermintTransport } = require('../../src/lettermint/index.js');
const { MailerooTransport } = require('../../src/maileroo/index.js');
const { MailerSendTransport } = require('../../src/mailersend/index.js');
const { MailgunTransport } = require('../../src/mailgun/index.js');
const { MailjetTransport } = require('../../src/mailjet/index.js');
const { MailtrapTransport } = require('../../src/mailtrap/index.js');
const { PlunkTransport } = require('../../src/plunk/index.js');
const { PostmarkTransport } = require('../../src/postmark/index.js');
const { ResendTransport } = require('../../src/resend/index.js');
const { ScalewayTransport } = require('../../src/scaleway/index.js');
const { SendGridTransport } = require('../../src/sendgrid/index.js');
const { SesTransport } = require('../../src/ses/index.js');
const { Smtp2goTransport } = require('../../src/smtp2go/index.js');
const { SparkPostTransport } = require('../../src/sparkpost/index.js');
const { ZeptoMailTransport } = require('../../src/zeptomail/index.js');

const message = () =>
  createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Hello',
    content: { text: 'Hi' },
  });

// What each runtime's fetch rejects with when the server's certificate is not
// trusted: Node a cause with the OpenSSL code, Bun the code on the error
// itself, Deno (rustls) only the text of its cause.
const refusals = {
  node: () =>
    new TypeError('fetch failed', {
      cause: Object.assign(new Error('unable to verify the first certificate'), {
        code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      }),
    }),
  bun: () =>
    Object.assign(new TypeError('unable to verify the first certificate'), {
      code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    }),
  deno: () =>
    new TypeError('fetch failed', {
      cause: new Error(
        'error sending request for url (https://api.example.com/): client error (Connect): ' +
          'invalid peer certificate: UnknownIssuer',
      ),
    }),
};

// Retries allowed, so that one taken shows as a second request.
const options = { retries: 2 };
const transports = {
  SES: (fetch) =>
    new SesTransport({
      ...options,
      fetch,
      authentication: { type: 'credentials', accessKeyId: 'a', secretAccessKey: 'b' },
    }),
  Resend: (fetch) => new ResendTransport({ ...options, fetch, apiKey: 'key' }),
  SendGrid: (fetch) => new SendGridTransport({ ...options, fetch, apiKey: 'key' }),
  Mailgun: (fetch) =>
    new MailgunTransport({ ...options, fetch, apiKey: 'key', domain: 'mg.example.com' }),
  Mailtrap: (fetch) => new MailtrapTransport({ ...options, fetch, apiToken: 'token' }),
  Maileroo: (fetch) => new MailerooTransport({ ...options, fetch, apiKey: 'key' }),
  Lettermint: (fetch) => new LettermintTransport({ ...options, fetch, apiToken: 'token' }),
  Plunk: (fetch) => new PlunkTransport({ ...options, fetch, apiKey: 'key' }),
  Postmark: (fetch) => new PostmarkTransport({ ...options, fetch, serverToken: 'token' }),
  Brevo: (fetch) => new BrevoTransport({ ...options, fetch, apiKey: 'key' }),
  Mailjet: (fetch) => new MailjetTransport({ ...options, fetch, apiKey: 'a', apiSecret: 'b' }),
  MailerSend: (fetch) => new MailerSendTransport({ ...options, fetch, apiKey: 'key' }),
  SparkPost: (fetch) => new SparkPostTransport({ ...options, fetch, apiKey: 'key' }),
  ZeptoMail: (fetch) => new ZeptoMailTransport({ ...options, fetch, token: 'token' }),
  SMTP2GO: (fetch) => new Smtp2goTransport({ ...options, fetch, apiKey: 'key' }),
  Azure: (fetch) =>
    new AzureTransport({
      ...options,
      fetch,
      connectionString: `endpoint=https://contoso.communication.azure.com/;accesskey=${btoa('k')}`,
    }),
  Scaleway: (fetch) =>
    new ScalewayTransport({
      ...options,
      fetch,
      secretKey: 'key',
      projectId: '11111111-2222-4333-8444-555555555555',
    }),
  Cloudflare: (fetch) =>
    new CloudflareTransport({
      ...options,
      fetch,
      accountId: '023e105f4ecef8ad9ca31a8372d0c353',
      apiToken: 'token',
    }),
  JMAP: (fetch) =>
    new JmapTransport({
      ...options,
      fetch,
      sessionUrl: 'https://jmap.example.com/session',
      bearerToken: 'token',
    }),
};

test('Certificates: a refused certificate is a configuration failure, sent nothing', () => {
  for (const [runtime, refusal] of Object.entries(refusals)) {
    assert.deepStrictEqual(
      classifyReceiptError(refusal()),
      { category: 'configuration', retryable: false, code: 'configuration' },
      runtime,
    );
    assert.strictEqual(isUnsentRequestError(refusal()), true, runtime);
  }
  const reset = new TypeError('fetch failed', { cause: new Error('connection reset by peer') });
  assert.strictEqual(classifyReceiptError(reset).category, 'network');
  assert.strictEqual(isUnsentRequestError(reset), false);
});

test('Certificates: every HTTP transport fails at once, as configuration, not retried', async () => {
  for (const [runtime, refusal] of Object.entries(refusals)) {
    for (const [name, create] of Object.entries(transports)) {
      let requests = 0;
      const fetch = async () => {
        requests++;
        throw refusal();
      };
      const receipt = await create(fetch).send(message());
      const label = `${name} on ${runtime}`;
      // Changed in this fix: Node's and Bun's were retried as network
      // failures and Deno's taken for an unknown delivery.
      assert.strictEqual(requests, 1, label);
      assert.strictEqual(receipt.successful, false, label);
      assert.strictEqual(receipt.errors[0].category, 'configuration', label);
      assert.strictEqual(receipt.retryable, false, label);
      assert.strictEqual(receipt.deliveryUnknown, undefined, label);
    }
  }
});

test('Certificates: so are the raw messages of JMAP and the providers that send them', async () => {
  const raw = {
    envelope: { from: 'alex@example.com', to: ['bob@example.com'] },
    content: new TextEncoder().encode(
      'From: alex@example.com\r\nTo: bob@example.com\r\nSubject: Hi\r\n\r\nHi\r\n',
    ),
  };
  for (const name of ['SES', 'Mailgun', 'SparkPost', 'Cloudflare', 'JMAP']) {
    let requests = 0;
    const fetch = async () => {
      requests++;
      throw refusals.deno();
    };
    const receipt = await transports[name](fetch).sendRaw(raw);
    assert.strictEqual(requests, 1, name);
    assert.strictEqual(receipt.errors[0].category, 'configuration', name);
    assert.strictEqual(receipt.retryable, false, name);
    assert.strictEqual(receipt.deliveryUnknown, undefined, name);
  }
});
