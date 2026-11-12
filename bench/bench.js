/**
 * Zero-dependency ops/sec benchmark for the mailer's hot paths.
 *
 * Run: pnpm bench [filter] [--json] [--save] [--compare]
 *
 * An optional filter runs only the scenarios whose name contains it, e.g.
 * `pnpm bench MIME`. `--json` prints the results as JSON, `--save` writes
 * them to bench/baseline.json, and `--compare` prints the change against
 * that baseline (numbers are machine-specific: compare on one machine, before
 * and after a change). Manual only, not part of CI.
 *
 * The scenarios run the library itself: composing a message with and
 * without an attachment or a DKIM signature, writing message data through
 * the SMTP dot-stuffing, and the checks that run once per message or per
 * address; for the channels, the segments of an SMS, the escaping of a text,
 * the redaction of numbers, and the signatures and encryption of a push.
 */

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const { bench, benchAsync, ATTACHMENT_1M, ADDRESS } = require('./helpers.js');
const {
  classifyReceiptError,
  createMessage,
  isEmailAddress,
  readAttachmentContent,
} = require('../index.js');
const { composeMessage } = require('../src/mime/index.js');
const { inlineDataUrls } = require('../src/attachments/index.js');
const { htmlToText } = require('../src/render/index.js');
const { fingerprintOf } = require('../src/internal/fingerprint.js');
const { hashJson } = require('../src/internal/canonical-json.js');
const { prepareJob } = require('../src/queue/index.js');
const { UNHASHED } = require('../src/queue/job.js');
const { gatedSendMany } = require('../src/internal/gate.js');
const { createMailtrapWebhookVerifier } = require('../src/webhooks/mailtrap/index.js');
const { createSendGridWebhookVerifier } = require('../src/webhooks/sendgrid/index.js');
const { createResendWebhookVerifier } = require('../src/webhooks/resend/index.js');
const { createSesWebhookVerifier } = require('../src/webhooks/ses/index.js');
const sns = require('../tests/helpers/webhooks/sns.js');
const { CircuitBreakerTransport } = require('../src/breaker/index.js');
const { HooksTransport } = require('../src/hooks/index.js');
const { IdempotencyTransport } = require('../src/idempotency/index.js');
const { RateLimitTransport } = require('../src/ratelimit/index.js');
const { TeeTransport } = require('../src/tee/index.js');
const { writeMessageData } = require('../src/smtp/data-stream.js');
const { PriorityStrategy } = require('../src/pool/strategies/priority-strategy.js');
const {
  countSegments,
  createChannelMessage,
  escapeDiscordMarkdown,
  escapeSlackText,
  escapeTelegramHtml,
  neutralizeMentions,
  normalizePhone,
} = require('../src/channels/index.js');
const { redactRecipients } = require('../src/internal/redact-addresses.js');
const { redactMessageRecipient } = require('../src/internal/channel/recipient.js');
const { signJwt } = require('../src/internal/jwt.js');
const { createSigV4Signer } = require('../src/internal/sigv4.js');
const { encryptPush } = require('../src/webpush/encryption.js');

const BASELINE = path.join(__dirname, 'baseline.json');
// A job of the queue as a worker reads it, and one with a file of 140 KB
// inline, some 190 KB of JSON.
const jobInput = {
  kind: 'content',
  from: 'App <app@example.com>',
  to: 'ada@example.com',
  subject: 'Your invoice',
  content: { text: 'Your invoice is attached.', html: '<p>Your invoice is attached.</p>' },
  idempotencyKey: 'invoice:1',
};
const smallJob = JSON.parse(JSON.stringify(prepareJob(jobInput).data));
// A job of Slack whose Block Kit is 2,000 small blocks: many tokens, not one.
const blocks = [];
for (let i = 0; i < 2000; i++) {
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `Line ${i} of the report` } });
}
const blockJob = JSON.parse(
  JSON.stringify(
    prepareJob({
      channel: 'slack',
      kind: 'content',
      to: 'C0123456',
      payload: { blocks },
      idempotencyKey: 'report:1',
    }).data,
  ),
);
const bigJob = JSON.parse(
  JSON.stringify(
    prepareJob({
      ...jobInput,
      attachments: [{ filename: 'invoice.pdf', content: crypto.randomBytes(140 * 1024) }],
    }).data,
  ),
);

// The texts of the channels: ten parts of an SMS in GSM-7 and in Cyrillic,
// one with emoji, and 4 KB of chat text full of what each markup escapes.
const gsmText = 'Your code is 1234. Do not share it with anyone; we never ask for it. '.repeat(22);
const cyrillicText = 'Ваш код 1234. Нікому його не повідомляйте. '.repeat(15);
const emojiText = 'Order shipped 📦 arriving soon 🚚 '.repeat(10);
const chatText = '<b>*_~`[link](x) @everyone <!channel> & > #5 | done_*</b> '.repeat(64);
const smsMessage = { channel: 'sms', to: '+380671234567', text: 'Your code is 1234' };
const logText = `Twilio refused +380671234567 and +14155550123 for ops@example.com. `.repeat(60);
const awsSigner = createSigV4Signer('eu-west-1', 'sms-voice');
const awsCredentials = { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' };
const pushKey = crypto.createECDH('prime256v1');
pushKey.generateKeys();
const subscription = { p256dh: pushKey.getPublicKey(), auth: crypto.randomBytes(16) };
const pushPayload = Buffer.from(JSON.stringify({ title: 'Shipped', body: 'x'.repeat(2000) }));
const es256 = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const filter = args.find((arg) => !arg.startsWith('--')) || '';
const json = flags.has('--json');

const percent = (current, base) => {
  const delta = ((current - base) / base) * 100;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
};

const compare = (results) => {
  if (!fs.existsSync(BASELINE)) {
    console.error(`No baseline at ${BASELINE}; run with --save first`);
    process.exitCode = 1;
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const base = new Map(baseline.results.map((row) => [row.name, row.opsPerSec]));
  console.log(`\nAgainst baseline from ${baseline.date} (${baseline.node}):`);
  for (const { name, opsPerSec } of results) {
    const before = base.get(name);
    const change = before ? percent(opsPerSec, before) : 'no baseline';
    console.log(`${name.padEnd(52)} ${change.padStart(12)}`);
  }
};

const textMessage = createMessage({
  from: 'Acme <no-reply@acme.example>',
  to: 'Алекс <alex@example.com>',
  subject: 'Скидання пароля: перейдіть за посиланням, щоб задати новий',
  content: {
    text: 'Перейдіть за посиланням, щоб скинути пароль: https://acme.example/reset/abc123\n'.repeat(
      20,
    ),
    html: '<p>Перейдіть за <a href="https://acme.example/reset/abc123">посиланням</a>.</p>'.repeat(
      20,
    ),
  },
});

const attachmentMessage = createMessage({
  from: 'no-reply@acme.example',
  to: 'alex@example.com',
  subject: 'Your invoice',
  content: { text: 'The invoice is attached.' },
  attachments: [
    {
      inline: false,
      filename: 'рахунок за жовтень.pdf',
      content: ATTACHMENT_1M,
      contentType: 'application/pdf',
      contentId: '',
    },
  ],
});

const composeAndRead = async (message, options) => {
  const composed = await composeMessage(message, options);
  return readAttachmentContent(composed.content);
};

// A socket that takes every write at once and answers the end of DATA.
const fakeSocket = () => {
  const socket = Object.assign(new EventEmitter(), { destroyed: false, writable: true });
  socket.destroy = () => {};
  socket.write = (chunk, callback) => {
    callback?.();
    if (chunk.length === 3 && chunk[0] === 0x2e) {
      queueMicrotask(() => socket.emit('data', Buffer.from('250 ok\r\n')));
    }
    return true;
  };
  return socket;
};

// One megabyte of text lines, a third of them starting with a dot.
const dottedBody = Buffer.from(
  Array.from({ length: 16384 }, (_, i) => (i % 3 === 0 ? '.' : 'x').repeat(62)).join('\r\n') +
    '\r\n',
);

// 100 KB of Cyrillic text, which goes base64, and of Latin text, which goes
// quoted-printable.
const cyrillicMessage = createMessage({
  from: ADDRESS,
  to: ADDRESS,
  subject: 'Рахунок',
  content: { text: 'Шановний клієнте, ваш рахунок за жовтень готовий. '.repeat(2000) },
});
const latinMessage = createMessage({
  from: ADDRESS,
  to: ADDRESS,
  subject: 'Invoice',
  content: { text: 'Dear customer, your invoice for October is ready, à bientôt. '.repeat(1700) },
});
const megabyteHtml = '<p>Hello <a href="https://example.com/x">world</a>, &amp; more</p>'.repeat(
  16000,
);
// The message of a fingerprint of 1 MiB of HTML.
const htmlMessage = createMessage({
  from: ADDRESS,
  to: ADDRESS,
  subject: 'Newsletter',
  content: { html: megabyteHtml, text: 'Newsletter' },
});
// 1 MB of HTML with twenty small images as data URIs.
const IMAGE =
  '<img alt="logo" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==">';
const imageHtml = `${IMAGE}${megabyteHtml.slice(0, 50_000)}`.repeat(20);

// Requests signed as each provider signs them, verified without a replay store.
const SVIX_SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const svixRequest = () => {
  const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'e', to: [ADDRESS] } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(SVIX_SECRET.slice(6), 'base64');
  const signature = crypto
    .createHmac('sha256', key)
    .update(`msg_1.${timestamp}.${body}`)
    .digest('base64');
  return {
    body,
    headers: {
      'svix-id': 'msg_1',
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${signature}`,
    },
  };
};
const ecdsa = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const sendgridRequest = () => {
  const body = JSON.stringify([
    { event: 'delivered', email: ADDRESS, sg_event_id: 'e1', timestamp: 1 },
  ]);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    body,
    headers: {
      'x-twilio-email-event-webhook-signature': crypto
        .sign('sha256', Buffer.from(timestamp + body), ecdsa.privateKey)
        .toString('base64'),
      'x-twilio-email-event-webhook-timestamp': timestamp,
    },
  };
};
const mailtrapBody = JSON.stringify({
  events: [{ event: 'delivery', event_id: 'e1', email: ADDRESS }],
});
const mailtrapRequest = {
  body: mailtrapBody,
  headers: {
    'mailtrap-signature': crypto.createHmac('sha256', 'mt').update(mailtrapBody).digest('hex'),
  },
};

// A transport that answers at once, under the five decorators of 1.1.
const instant = {
  id: 'instant',
  send: async () => ({ successful: true, messageId: 'm' }),
  async *sendMany(messages) {
    for await (const message of messages) yield { successful: true, messageId: 'm', message };
  },
};
const decorated = new HooksTransport(
  new TeeTransport(
    new IdempotencyTransport(
      new RateLimitTransport(new CircuitBreakerTransport(instant), { limit: 1e9, burst: 1e9 }),
    ),
    { mirrors: [instant], awaitMirrors: true },
  ),
  { afterSend: () => {} },
);
const hundred = Array.from({ length: 100 }, () => textMessage);

// 10,000 sends waiting for one bucket, all served by the next refill.
const queued = async () => {
  const limiter = new RateLimitTransport(instant, { limit: 1e7, intervalMs: 1000, burst: 1 });
  const sends = [];
  for (let i = 0; i < 10_000; i++) sends.push(limiter.send(textMessage));
  return (await Promise.all(sends)).length;
};

const main = async () => {
  if (!json) console.log(`Node ${process.version} | ${new Date().toISOString()}\n`);
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const dkim = {
    signatures: [
      {
        signingDomain: 'acme.example',
        selector: 'mail',
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      },
    ],
  };
  const strategy = new PriorityStrategy();
  const transports = Array.from({ length: 10 }, (_, i) => ({
    transport: { id: `t${i}` },
    enabled: true,
    priority: i % 3,
    weight: 1,
  }));
  const failure = new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' }),
  });
  const slow = { warmup: 20 };
  const resend = createResendWebhookVerifier({ secret: SVIX_SECRET, replayStore: null });
  const sendgrid = createSendGridWebhookVerifier({
    publicKey: ecdsa.publicKey.export({ format: 'pem', type: 'spki' }),
    replayStore: null,
  });
  const mailtrap = createMailtrapWebhookVerifier({
    secret: 'mt',
    replayStore: null,
  });
  // Signed once: the cases time the verification, not the signing.
  const svixSigned = svixRequest();
  const sendgridSigned = sendgridRequest();
  // An SNS message of SES, its certificate read once and kept.
  const ses = createSesWebhookVerifier({
    topicArns: [sns.TOPIC],
    fetch: sns.certificateFetch().fetch,
    now: () => Date.parse('2027-01-01T12:00:30Z'),
    replayStore: null,
  });
  const snsRequest = {
    body: JSON.stringify(sns.notification({ eventType: 'Send', mail: { messageId: 'm' } })),
  };
  await ses.verify(snsRequest);

  const scenarios = [
    ['MIME — compose a text and HTML message', () => composeAndRead(textMessage), slow],
    [
      'MIME — compose a message with a 1 MiB attachment',
      () => composeAndRead(attachmentMessage),
      slow,
    ],
    [
      'DKIM — compose and sign a text message (RSA-2048)',
      () => composeAndRead(textMessage, { dkim }),
      slow,
    ],
    [
      'SMTP — dot-stuff and write 1 MiB of message data',
      () =>
        writeMessageData(
          fakeSocket(),
          async function* () {
            yield dottedBody;
          },
          60_000,
          () => {},
        ),
      slow,
    ],
    ['Address — isEmailAddress', () => isEmailAddress(ADDRESS)],
    ['Receipt — classifyReceiptError of a reset', () => classifyReceiptError(failure)],
    [
      'Pool — select by priority among 10 transports',
      () => strategy.select(textMessage, transports, new Set()),
    ],
    ['MIME — compose 100 KB of Cyrillic (base64)', () => composeAndRead(cyrillicMessage), slow],
    ['MIME — compose 100 KB of Latin (quoted-printable)', () => composeAndRead(latinMessage), slow],
    ['Render — htmlToText of 1 MB', () => htmlToText(megabyteHtml), slow],
    ['Idempotency — fingerprintOf a message', () => fingerprintOf(textMessage)],
    ['Idempotency — fingerprintOf 1 MiB of HTML', () => fingerprintOf(htmlMessage), slow],
    ['Queue — hashJson of a job', () => hashJson(smallJob, UNHASHED)],
    ['Queue — hashJson of a job of 190 KB', () => hashJson(bigJob, UNHASHED), slow],
    ['Queue — hashJson of a job of 2,000 blocks', () => hashJson(blockJob, UNHASHED), slow],
    ['Webhooks — verify a Svix (Resend) request', () => resend.verify(svixSigned)],
    ['Webhooks — verify a SendGrid ECDSA request', () => sendgrid.verify(sendgridSigned)],
    ['Webhooks — verify a Mailtrap HMAC request', () => mailtrap.verify(mailtrapRequest)],
    ['Webhooks — verify an SNS RSA message, its certificate kept', () => ses.verify(snsRequest)],
    ['Attachments — inlineDataUrls of 1 MB with 20 images', () => inlineDataUrls(imageHtml), slow],
    ['Channels — countSegments of 10 parts of GSM-7', () => countSegments(gsmText)],
    ['Channels — countSegments of 10 parts of Cyrillic', () => countSegments(cyrillicText)],
    ['Channels — countSegments of a text with emoji', () => countSegments(emojiText)],
    ['Channels — normalizePhone of a national number', () => normalizePhone('067 123 45 67', 'UA')],
    [
      'Channels — createChannelMessage of an SMS',
      () =>
        createChannelMessage(
          { channel: 'sms', to: '067 123 45 67', text: 'Your code is 1234' },
          { defaultCountry: 'UA' },
        ),
    ],
    ['Channels — escapeTelegramHtml of 4 KB', () => escapeTelegramHtml(chatText)],
    ['Channels — escapeSlackText of 4 KB', () => escapeSlackText(chatText)],
    ['Channels — escapeDiscordMarkdown of 4 KB', () => escapeDiscordMarkdown(chatText)],
    ['Channels — neutralizeMentions of 4 KB', () => neutralizeMentions(chatText)],
    ['Channels — redactRecipients of 4 KB of a log', () => redactRecipients(logText)],
    [
      'Channels — redactMessageRecipient of an error of an SMS',
      () => redactMessageRecipient('Twilio: 380671234567 is unreachable', smsMessage),
    ],
    [
      'Channels — sign an AWS SMS request (SigV4)',
      () =>
        awsSigner(
          'https://sms-voice.eu-west-1.amazonaws.com/',
          { method: 'POST', headers: { 'Content-Type': 'application/x-amz-json-1.0' }, body: '{}' },
          awsCredentials,
        ),
    ],
    [
      'Channels — sign an ES256 JWT (APNs, VAPID)',
      () => signJwt({ alg: 'ES256', kid: 'KEY1234567' }, { iss: 'TEAM123456', iat: 1 }, es256),
    ],
    [
      'Channels — encrypt a 2 KB Web Push (aes128gcm)',
      () => encryptPush(pushPayload, subscription),
      slow,
    ],
    ['RateLimit — 10,000 sends waiting for one bucket', queued, slow],
    [
      'Gate — 100 messages through five decorators',
      async () => {
        let sent = 0;
        for await (const receipt of decorated.sendMany(hundred)) if (receipt.successful) sent++;
        return sent;
      },
      slow,
    ],
    [
      'Gate — 100 messages, every tenth answered in place',
      async () => {
        // The admissions are counted apart from the receipts, so that every
        // tenth message is answered in place.
        let admitted = 0;
        let sent = 0;
        for await (const receipt of gatedSendMany(instant, hundred, undefined, {
          admit: (message) =>
            ++admitted % 10 === 0
              ? { receipt: { successful: true, messageId: 'own' } }
              : { message },
        })) {
          if (receipt.successful) sent++;
        }
        return sent;
      },
      slow,
    ],
  ];

  const results = [];
  for (const [name, fn, options] of scenarios) {
    if (!name.includes(filter)) continue;
    const isAsync = fn() instanceof Promise;
    const run = isAsync ? benchAsync : bench;
    results.push(await run(name, fn, { ...options, quiet: json }));
  }
  if (json) console.log(JSON.stringify(results, null, 2));
  if (flags.has('--save')) {
    const snapshot = { node: process.version, date: new Date().toISOString(), results };
    fs.writeFileSync(BASELINE, `${JSON.stringify(snapshot, null, 2)}\n`);
    if (!json) console.log(`\nSaved ${results.length} results to ${BASELINE}`);
  }
  if (flags.has('--compare')) compare(results);
};

main();
