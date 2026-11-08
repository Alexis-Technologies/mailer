// Not ported: the providers of the channels the delivery matrix holds, each
// with a message of its channel, the answer of a send, a rate limit as it
// tells it, and what must never reach a log: its secrets and its recipient.
const { createECDH, generateKeyPairSync } = require('node:crypto');
const { createChannelMessage } = require('../../../src/channels/index.js');
const { DiscordTransport } = require('../../../src/discord/index.js');
const { FcmTransport } = require('../../../src/fcm/index.js');
const { MetaTransport } = require('../../../src/meta/index.js');
const { TwilioTransport } = require('../../../src/twilio/index.js');
const { AwsSmsTransport } = require('../../../src/aws-sms/index.js');
const { WebPushTransport } = require('../../../src/webpush/index.js');
const { SlackTransport } = require('../../../src/slack/index.js');
const { TelegramTransport } = require('../../../src/telegram/index.js');

const TELEGRAM_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const SLACK_TOKEN = 'xoxb-1111-2222-SlackBotSecret';
const DISCORD_TOKEN = 'MTA.DiscordBotSecret.xyz';
const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/123/DiscordWebhookSecret';
const FCM_ACCESS_TOKEN = 'ya29.FcmAccessSecret';
const FCM_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});
const FCM_ACCOUNT = {
  type: 'service_account',
  project_id: 'mailer-test-1',
  client_email: 'push@mailer-test-1.iam.gserviceaccount.com',
  private_key: FCM_KEY,
};
const VAPID = createECDH('prime256v1');
VAPID.generateKeys();
const BROWSER = createECDH('prime256v1');
BROWSER.generateKeys();
const SUBSCRIPTION = {
  endpoint: 'https://push.example.com/v1/SECRETSUBSCRIPTION',
  keys: { p256dh: BROWSER.getPublicKey().toString('base64url'), auth: 'AAAAAAAAAAAAAAAAAAAAAA' },
};

// The fetch of a transport of Google whose token endpoint answers apart, so
// that a test's fetch sees the requests of the provider alone.
const withGoogleToken = (fetch) =>
  fetch === undefined
    ? undefined
    : (url, init) =>
        String(url).startsWith('https://oauth2.googleapis.com/')
          ? Promise.resolve(Response.json({ access_token: FCM_ACCESS_TOKEN, expires_in: 3600 }))
          : fetch(url, init);
const SLACK_WEBHOOK = 'https://hooks.slack.com/services/T000/B000/SlackWebhookSecret';

const channelProviders = [
  {
    name: 'Telegram',
    create: (extra) => new TelegramTransport({ retries: 1, ...extra, botToken: TELEGRAM_TOKEN }),
    message: () =>
      createChannelMessage({ channel: 'telegram', to: 987654321, text: 'Your code is 1234' }),
    ok: () => Response.json({ ok: true, result: { message_id: 7, chat: { id: 987654321 } } }),
    // Telegram tells the wait in its body, not in Retry-After.
    rateLimited: (seconds) =>
      Response.json(
        {
          ok: false,
          error_code: 429,
          description: `Too Many Requests: retry after ${seconds}`,
          parameters: { retry_after: seconds },
        },
        { status: 429 },
      ),
    secrets: [TELEGRAM_TOKEN, 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'],
    recipient: '987654321',
  },
  {
    name: 'Slack',
    create: (extra) =>
      new SlackTransport({
        retries: 1,
        ...extra,
        botToken: SLACK_TOKEN,
        webhookUrl: SLACK_WEBHOOK,
      }),
    message: () =>
      createChannelMessage({ channel: 'slack', to: 'C0SECRETCHAN', text: 'Deployed v1.2.3' }),
    ok: () => Response.json({ ok: true, channel: 'C0SECRETCHAN', ts: '1700000000.000100' }),
    rateLimited: (seconds) =>
      Response.json(
        { ok: false, error: 'ratelimited' },
        { status: 429, headers: { 'Retry-After': String(seconds) } },
      ),
    secrets: [SLACK_TOKEN, 'SlackBotSecret', 'SlackWebhookSecret'],
    recipient: 'C0SECRETCHAN',
  },
  {
    name: 'Slack webhook',
    create: (extra) => new SlackTransport({ retries: 1, ...extra, webhookUrl: SLACK_WEBHOOK }),
    message: () => createChannelMessage({ channel: 'slack', text: 'Deployed v1.2.3' }),
    ok: () => new Response('ok'),
    rateLimited: (seconds) =>
      new Response('rate_limited', { status: 429, headers: { 'Retry-After': String(seconds) } }),
    secrets: ['SlackWebhookSecret'],
    recipient: 'SlackWebhookSecret',
  },
  {
    name: 'Discord webhook',
    create: (extra) => new DiscordTransport({ retries: 1, ...extra, webhookUrl: DISCORD_WEBHOOK }),
    message: () => createChannelMessage({ channel: 'discord', text: 'Deployed v1.2.3' }),
    ok: () => Response.json({ id: '1100000000000000001' }),
    rateLimited: (seconds) =>
      Response.json(
        { message: 'You are being rate limited.', retry_after: seconds, global: false },
        { status: 429 },
      ),
    secrets: ['DiscordWebhookSecret'],
    recipient: 'DiscordWebhookSecret',
  },
  {
    // A send of a bot carries a nonce Discord dedupes by: a lost answer is
    // sent again, as the same message, and only its last failure is marked.
    name: 'Discord',
    keyed: true,
    create: (extra) => new DiscordTransport({ retries: 1, ...extra, botToken: DISCORD_TOKEN }),
    message: () =>
      createChannelMessage({ channel: 'discord', to: '1100000000000000099', text: 'Deployed' }),
    ok: () => Response.json({ id: '1100000000000000001' }),
    rateLimited: (seconds) =>
      Response.json(
        { message: 'You are being rate limited.', retry_after: seconds, global: false },
        { status: 429 },
      ),
    secrets: [DISCORD_TOKEN, 'DiscordBotSecret'],
    recipient: '1100000000000000099',
  },
  {
    name: 'FCM',
    create: (extra = {}) =>
      new FcmTransport({
        retries: 1,
        ...extra,
        fetch: withGoogleToken(extra.fetch),
        serviceAccount: FCM_ACCOUNT,
      }),
    message: () =>
      createChannelMessage({
        channel: 'push',
        to: { token: 'fcm-device-token-SECRETDEVICE' },
        title: 'Shipped',
        text: 'Your order shipped',
      }),
    ok: () => Response.json({ name: 'projects/mailer-test-1/messages/0:1' }),
    rateLimited: (seconds) =>
      Response.json(
        {
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'Quota exceeded',
            details: [
              {
                '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
                errorCode: 'QUOTA_EXCEEDED',
              },
            ],
          },
        },
        { status: 429, headers: { 'Retry-After': String(seconds) } },
      ),
    secrets: [FCM_ACCESS_TOKEN, FCM_KEY.split('\n')[2]],
    recipient: 'SECRETDEVICE',
  },
  {
    name: 'Web Push',
    create: (extra = {}) =>
      new WebPushTransport({
        retries: 1,
        ...extra,
        vapid: {
          subject: 'mailto:ops@example.com',
          publicKey: VAPID.getPublicKey().toString('base64url'),
          privateKey: VAPID.getPrivateKey().toString('base64url'),
        },
        // A public address, without a lookup of the network.
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      }),
    message: () =>
      createChannelMessage({
        channel: 'push',
        to: SUBSCRIPTION,
        title: 'Shipped',
        text: 'On its way',
      }),
    ok: () =>
      new Response(null, { status: 201, headers: { Location: 'https://push.example.com/m/1' } }),
    rateLimited: (seconds) =>
      new Response('slow down', { status: 429, headers: { 'Retry-After': String(seconds) } }),
    // The endpoint is the subscription's, which createChannelMessage holds
    // to https.
    insecure: () =>
      createChannelMessage({
        channel: 'push',
        to: { ...SUBSCRIPTION, endpoint: 'http://push.example.com/v1/x' },
        title: 'x',
      }),
    secrets: [VAPID.getPrivateKey().toString('base64url')],
    recipient: 'SECRETSUBSCRIPTION',
  },
  {
    name: 'Meta',
    create: (extra) =>
      new MetaTransport({
        retries: 1,
        ...extra,
        accessToken: 'EAAGMetaSecretToken',
        whatsapp: { phoneNumberId: '1100000000000001' },
      }),
    message: () =>
      createChannelMessage({ channel: 'whatsapp', to: '+380671234567', text: 'Your code is 1234' }),
    ok: () => Response.json({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.HBg' }] }),
    rateLimited: (seconds) =>
      Response.json(
        { error: { message: 'Rate limit hit', code: 130429 } },
        { status: 429, headers: { 'Retry-After': String(seconds) } },
      ),
    secrets: ['EAAGMetaSecretToken'],
    recipient: '380671234567',
  },
  {
    name: 'Twilio',
    create: (extra) =>
      new TwilioTransport({
        retries: 1,
        ...extra,
        accountSid: 'AC00000000000000000000000000000000',
        authToken: 'TwilioAuthSecret',
        from: '+15005550006',
      }),
    message: () =>
      createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'Your code is 1234' }),
    ok: () =>
      Response.json(
        { sid: `SM${'a'.repeat(32)}`, status: 'queued', num_segments: '1' },
        { status: 201 },
      ),
    rateLimited: (seconds) =>
      Response.json(
        { code: 20429, message: 'Too Many Requests', status: 429 },
        { status: 429, headers: { 'Retry-After': String(seconds) } },
      ),
    secrets: [
      'TwilioAuthSecret',
      Buffer.from('AC00000000000000000000000000000000:TwilioAuthSecret').toString('base64'),
    ],
    recipient: '380671234567',
  },
  {
    name: 'AWS SMS',
    create: (extra) =>
      new AwsSmsTransport({
        retries: 1,
        ...extra,
        credentials: { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'AwsSecretAccessKey' },
      }),
    message: () =>
      createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'Your code is 1234' }),
    ok: () => Response.json({ MessageId: 'aws-message-1' }),
    rateLimited: (seconds) =>
      Response.json(
        { __type: 'ThrottlingException', Message: 'Rate exceeded' },
        { status: 400, headers: { 'Retry-After': String(seconds) } },
      ),
    secrets: ['AwsSecretAccessKey'],
    recipient: '380671234567',
  },
];

module.exports = { channelProviders };
