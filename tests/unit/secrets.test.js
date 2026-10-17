// Credentials of the transports stay out of what logs and error reporters
// print: util.inspect(), console.log() and JSON.stringify() of a transport.
const { test } = require('node:test');
const assert = require('node:assert');
const { Socket } = require('node:net');
const { inspect } = require('node:util');
const { redactSecrets } = require('../../src/internal/redact.js');
const { JmapTransport } = require('../../src/jmap/index.js');
const { LettermintTransport } = require('../../src/lettermint/index.js');
const { MailerooTransport } = require('../../src/maileroo/index.js');
const { MailgunTransport } = require('../../src/mailgun/index.js');
const { MailtrapTransport } = require('../../src/mailtrap/index.js');
const { PlunkTransport } = require('../../src/plunk/index.js');
const { PoolTransport } = require('../../src/pool/index.js');
const { ResendTransport } = require('../../src/resend/index.js');
const { RetryTransport } = require('../../src/retry/index.js');
const { SendGridTransport } = require('../../src/sendgrid/index.js');
const { SesTransport } = require('../../src/ses/index.js');
const { SmtpTransport } = require('../../src/smtp/index.js');

const { TEST_DKIM_PRIVATE_KEY } = require('../helpers/mime/dkim-test-keys.js');

const SECRET = 'secret-value-1f3a';
// A line of the body of the PEM key, which a transport now reads when made.
const KEY_LINE = TEST_DKIM_PRIVATE_KEY.split('\n')[1];

const transports = () => [
  new SmtpTransport({
    host: 'smtp.example.com',
    auth: { user: 'alex', pass: SECRET },
    dkim: {
      signatures: [
        { signingDomain: 'example.com', selector: 's', privateKey: TEST_DKIM_PRIVATE_KEY },
      ],
    },
  }),
  new SmtpTransport({
    host: 'smtp.example.com',
    auth: {
      type: 'oauth2',
      user: 'alex',
      clientId: 'client',
      clientSecret: SECRET,
      refreshToken: SECRET,
      tokenEndpoint: 'https://auth.example.com/token',
      accessToken: SECRET,
    },
  }),
  new SesTransport({
    authentication: {
      type: 'credentials',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: SECRET,
      sessionToken: SECRET,
    },
  }),
  new ResendTransport({ apiKey: SECRET, headers: { Authorization: `Bearer ${SECRET}` } }),
  new SendGridTransport({ apiKey: SECRET }),
  new MailgunTransport({ apiKey: SECRET, domain: 'mg.example.com' }),
  new MailtrapTransport({ apiToken: SECRET }),
  new MailerooTransport({ apiKey: SECRET, headers: { 'X-API-Key': SECRET } }),
  new LettermintTransport({ apiToken: SECRET }),
  new PlunkTransport({ apiKey: SECRET }),
  new JmapTransport({ sessionUrl: 'https://jmap.example.com/session', bearerToken: SECRET }),
  new JmapTransport({
    sessionUrl: 'https://jmap.example.com/session',
    basicAuth: { username: 'alex', password: SECRET },
  }),
];

test('Secrets: no transport shows its credentials to util.inspect() or JSON.stringify()', () => {
  for (const transport of transports()) {
    const inspected = inspect(transport, { depth: Infinity });
    assert.ok(!inspected.includes(SECRET), inspected);
    assert.ok(!inspected.includes(KEY_LINE), inspected);
    assert.ok(inspected.startsWith(`${transport.constructor.name} `), inspected);
    assert.match(inspected, /\[REDACTED\]/);
    const json = JSON.stringify(transport);
    assert.ok(!json.includes(SECRET), json);
    assert.ok(!json.includes(KEY_LINE), json);
  }
});

test('Secrets: the configuration itself keeps its credentials', () => {
  const transport = new ResendTransport({ apiKey: SECRET });
  assert.strictEqual(transport.config.apiKey, SECRET);
  assert.strictEqual(inspect(transport.config).includes(SECRET), true);
});

test('Secrets: a decorator does not show the credentials of what it wraps', () => {
  const wrapped = [
    new RetryTransport(new ResendTransport({ apiKey: SECRET })),
    new PoolTransport({
      strategy: 'round-robin',
      transports: [{ transport: new SendGridTransport({ apiKey: SECRET }) }],
    }),
  ];
  for (const transport of wrapped) {
    assert.ok(!inspect(transport, { depth: Infinity }).includes(SECRET));
    assert.ok(!JSON.stringify(transport).includes(SECRET));
  }
});

test('Secrets: redaction copies arrays and records, keeps built-in values, names emitters', () => {
  const date = new Date(0);
  const headers = new Map([['Authorization', 'kept, as a Map is not walked']]);
  const record = { list: [{ token: SECRET }, 1], date, headers, socket: new Socket(), empty: null };
  record.self = record;
  const copy = redactSecrets(record);
  assert.deepStrictEqual(copy.list, [{ token: '[REDACTED]' }, 1]);
  assert.strictEqual(copy.date, date);
  assert.strictEqual(copy.headers, headers);
  assert.strictEqual(copy.socket, '[Socket]');
  assert.strictEqual(copy.self, '[Circular]');
  assert.strictEqual(copy.empty, null);
  assert.deepStrictEqual(redactSecrets({ password: undefined }), { password: undefined });
});

test('Secrets: the transports and decorators of 1.1 show no credentials either', () => {
  // The redaction goes by the names of the fields; this goes by the values,
  // so that a field of a new name does not leak unnoticed.
  const { AzureTransport } = require('../../src/azure/index.js');
  const { BrevoTransport } = require('../../src/brevo/index.js');
  const { CloudflareTransport } = require('../../src/cloudflare/index.js');
  const { MailerSendTransport } = require('../../src/mailersend/index.js');
  const { MailjetTransport } = require('../../src/mailjet/index.js');
  const { PostmarkTransport } = require('../../src/postmark/index.js');
  const { ScalewayTransport } = require('../../src/scaleway/index.js');
  const { SendmailTransport } = require('../../src/sendmail/index.js');
  const { Smtp2goTransport } = require('../../src/smtp2go/index.js');
  const { SparkPostTransport } = require('../../src/sparkpost/index.js');
  const { ZeptoMailTransport } = require('../../src/zeptomail/index.js');
  const { CircuitBreakerTransport } = require('../../src/breaker/index.js');
  const { HooksTransport } = require('../../src/hooks/index.js');
  const { IdempotencyTransport } = require('../../src/idempotency/index.js');
  const { RateLimitTransport } = require('../../src/ratelimit/index.js');
  const { TeeTransport } = require('../../src/tee/index.js');
  const base64Secret = Buffer.from(SECRET).toString('base64');
  const dkim = {
    signatures: [
      { signingDomain: 'example.com', selector: 's', privateKey: TEST_DKIM_PRIVATE_KEY },
    ],
  };
  const providers = [
    new PostmarkTransport({ serverToken: SECRET }),
    new BrevoTransport({ apiKey: SECRET }),
    new MailjetTransport({ apiKey: 'public', apiSecret: SECRET }),
    new MailerSendTransport({ apiKey: SECRET }),
    new SparkPostTransport({ apiKey: SECRET }),
    new ZeptoMailTransport({ token: SECRET }),
    new Smtp2goTransport({ apiKey: SECRET }),
    new AzureTransport({
      endpoint: 'https://contoso.communication.azure.com',
      accessKey: base64Secret,
    }),
    new AzureTransport({
      connectionString: `endpoint=https://contoso.communication.azure.com/;accesskey=${base64Secret}`,
    }),
    new ScalewayTransport({ secretKey: SECRET, projectId: '11111111-2222-4333-8444-555555555555' }),
    new CloudflareTransport({ accountId: '023e105f4ecef8ad9ca31a8372d0c353', apiToken: SECRET }),
    new SendmailTransport({ dkim }),
  ];
  const decorated = [
    new CircuitBreakerTransport(new PostmarkTransport({ serverToken: SECRET })),
    new RateLimitTransport(new BrevoTransport({ apiKey: SECRET }), { limit: 1 }),
    new IdempotencyTransport(new SparkPostTransport({ apiKey: SECRET })),
    new HooksTransport(new ZeptoMailTransport({ token: SECRET })),
    new TeeTransport(new Smtp2goTransport({ apiKey: SECRET }), {
      mirrors: [new CloudflareTransport({ accountId: 'a'.repeat(32), apiToken: SECRET })],
    }),
  ];
  for (const transport of [...providers, ...decorated]) {
    for (const shown of [inspect(transport, { depth: Infinity }), JSON.stringify(transport)]) {
      for (const secret of [SECRET, base64Secret, KEY_LINE]) {
        assert.ok(!shown.includes(secret), `${transport.constructor.name}: ${shown}`);
      }
    }
  }
});
