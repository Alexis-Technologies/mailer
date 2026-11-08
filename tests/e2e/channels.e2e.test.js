// Not ported: the providers of the channels against their real APIs, each
// skipped until its variables are set: the credentials and the recipient
// named in its row below. A provider is released only after this suite ran
// on a real account (CLAUDE.md, Release process).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createChannelMessage } = require('../../src/channels/index.js');

const env = process.env;

// Each provider: its transport, the variables it needs, its configuration
// from them, one whose credentials the provider refuses, and the messages
// of its channel: a text, one with a medium, and one with a button.
const PROVIDERS = [
  {
    name: 'Telegram',
    Transport: require('../../src/telegram/index.js').TelegramTransport,
    needs: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
    config: () => ({ botToken: env.TELEGRAM_BOT_TOKEN, parseMode: 'HTML' }),
    refused: () => ({ botToken: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }),
    message: (fields) =>
      createChannelMessage({ channel: 'telegram', to: env.TELEGRAM_CHAT_ID, ...fields }),
  },
  {
    name: 'Slack',
    Transport: require('../../src/slack/index.js').SlackTransport,
    needs: ['SLACK_BOT_TOKEN', 'SLACK_CHANNEL'],
    config: () => ({ botToken: env.SLACK_BOT_TOKEN }),
    refused: () => ({ botToken: 'xoxb-0000000000-0000000000000-invalid' }),
    message: (fields) =>
      createChannelMessage({ channel: 'slack', to: env.SLACK_CHANNEL, ...fields }),
  },
  {
    name: 'Slack webhook',
    Transport: require('../../src/slack/index.js').SlackTransport,
    needs: ['SLACK_WEBHOOK_URL'],
    config: () => ({ webhookUrl: env.SLACK_WEBHOOK_URL }),
    refused: () => ({ webhookUrl: 'https://hooks.slack.com/services/T000/B000/invalid' }),
    message: (fields) => createChannelMessage({ channel: 'slack', ...fields }),
  },
  {
    name: 'Discord',
    Transport: require('../../src/discord/index.js').DiscordTransport,
    needs: ['DISCORD_BOT_TOKEN', 'DISCORD_CHANNEL_ID'],
    config: () => ({ botToken: env.DISCORD_BOT_TOKEN }),
    refused: () => ({ botToken: 'MTAwMDAwMDAwMDAwMDAwMDAw.invalid.invalid' }),
    message: (fields) =>
      createChannelMessage({ channel: 'discord', to: env.DISCORD_CHANNEL_ID, ...fields }),
  },
  {
    name: 'Discord webhook',
    Transport: require('../../src/discord/index.js').DiscordTransport,
    needs: ['DISCORD_WEBHOOK_URL'],
    config: () => ({ webhookUrl: env.DISCORD_WEBHOOK_URL }),
    refused: () => ({ webhookUrl: 'https://discord.com/api/webhooks/1/invalid' }),
    message: (fields) => createChannelMessage({ channel: 'discord', ...fields }),
  },
  {
    name: 'FCM',
    Transport: require('../../src/fcm/index.js').FcmTransport,
    needs: ['FCM_SERVICE_ACCOUNT', 'FCM_TOKEN'],
    config: () => ({ serviceAccount: JSON.parse(env.FCM_SERVICE_ACCOUNT) }),
    // The account of the project with a key Google never issued.
    refused: () => ({
      serviceAccount: {
        ...JSON.parse(env.FCM_SERVICE_ACCOUNT),
        private_key: require('node:crypto')
          .generateKeyPairSync('rsa', { modulusLength: 2048 })
          .privateKey.export({ type: 'pkcs8', format: 'pem' }),
      },
    }),
    message: ({ text, media }) =>
      createChannelMessage({
        channel: 'push',
        to: { token: env.FCM_TOKEN },
        title: '@alexify/mailer',
        text,
        media: media?.slice(0, 1),
      }),
  },
  {
    name: 'WhatsApp',
    Transport: require('../../src/meta/index.js').MetaTransport,
    // The test number of a business, and a number it may write to.
    needs: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TO'],
    config: () => ({
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      whatsapp: { phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID },
    }),
    refused: () => ({
      accessToken: 'EAAGinvalid',
      whatsapp: { phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID },
    }),
    // Outside the window of the test number, the template every account has.
    message: () =>
      createChannelMessage({
        channel: 'whatsapp',
        to: env.WHATSAPP_TO,
        template: { name: 'hello_world', language: 'en_US' },
      }),
  },
  {
    name: 'Messenger',
    Transport: require('../../src/meta/index.js').MetaTransport,
    needs: ['MESSENGER_PAGE_ID', 'MESSENGER_PAGE_TOKEN', 'MESSENGER_PSID'],
    config: () => ({
      messenger: { pageId: env.MESSENGER_PAGE_ID, accessToken: env.MESSENGER_PAGE_TOKEN },
    }),
    refused: () => ({ messenger: { pageId: env.MESSENGER_PAGE_ID, accessToken: 'EAAGinvalid' } }),
    message: ({ text, buttons }) =>
      createChannelMessage({ channel: 'messenger', to: env.MESSENGER_PSID, text, buttons }),
  },
  {
    name: 'Twilio',
    Transport: require('../../src/twilio/index.js').TwilioTransport,
    needs: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'TWILIO_TO'],
    config: () => ({
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      from: env.TWILIO_FROM,
    }),
    refused: () => ({
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: 'invalid',
      from: env.TWILIO_FROM,
    }),
    message: ({ text, media }) =>
      createChannelMessage({
        channel: 'sms',
        to: env.TWILIO_TO,
        text,
        media: media?.filter((medium) => medium.url !== undefined),
      }),
  },
  {
    name: 'AWS SMS',
    Transport: require('../../src/aws-sms/index.js').AwsSmsTransport,
    // A number the sandbox verified, and the credentials of the account.
    needs: ['AWS_SMS_ACCESS_KEY_ID', 'AWS_SMS_SECRET_ACCESS_KEY', 'AWS_SMS_REGION', 'AWS_SMS_TO'],
    config: () => ({
      credentials: {
        accessKeyId: env.AWS_SMS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SMS_SECRET_ACCESS_KEY,
      },
      region: env.AWS_SMS_REGION,
      ...(env.AWS_SMS_FROM && { originationIdentity: env.AWS_SMS_FROM }),
    }),
    refused: () => ({
      credentials: { accessKeyId: env.AWS_SMS_ACCESS_KEY_ID, secretAccessKey: 'invalid' },
      region: env.AWS_SMS_REGION,
    }),
    message: ({ text }) => createChannelMessage({ channel: 'sms', to: env.AWS_SMS_TO, text }),
  },
  {
    name: 'Vonage',
    Transport: require('../../src/vonage/index.js').VonageTransport,
    needs: ['VONAGE_API_KEY', 'VONAGE_API_SECRET', 'VONAGE_FROM', 'VONAGE_TO'],
    config: () => ({
      apiKey: env.VONAGE_API_KEY,
      apiSecret: env.VONAGE_API_SECRET,
      from: env.VONAGE_FROM,
    }),
    refused: () => ({ apiKey: env.VONAGE_API_KEY, apiSecret: 'invalid', from: env.VONAGE_FROM }),
    message: ({ text }) => createChannelMessage({ channel: 'sms', to: env.VONAGE_TO, text }),
  },
  {
    name: 'Infobip',
    Transport: require('../../src/infobip/index.js').InfobipTransport,
    needs: ['INFOBIP_API_KEY', 'INFOBIP_BASE_URL', 'INFOBIP_TO'],
    config: () => ({
      apiKey: env.INFOBIP_API_KEY,
      baseUrl: env.INFOBIP_BASE_URL,
      ...(env.INFOBIP_FROM && { from: env.INFOBIP_FROM }),
    }),
    refused: () => ({ apiKey: 'invalid', baseUrl: env.INFOBIP_BASE_URL }),
    // The validity period too, which the unit suite cannot check against
    // Infobip itself.
    message: ({ text }) =>
      createChannelMessage({
        channel: 'sms',
        to: env.INFOBIP_TO,
        text,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      }),
  },
  {
    name: 'Sinch',
    Transport: require('../../src/sinch/index.js').SinchTransport,
    needs: ['SINCH_SERVICE_PLAN_ID', 'SINCH_API_TOKEN', 'SINCH_TO'],
    config: () => ({
      servicePlanId: env.SINCH_SERVICE_PLAN_ID,
      apiToken: env.SINCH_API_TOKEN,
      ...(env.SINCH_REGION && { region: env.SINCH_REGION }),
      ...(env.SINCH_FROM && { from: env.SINCH_FROM }),
    }),
    refused: () => ({
      servicePlanId: env.SINCH_SERVICE_PLAN_ID,
      apiToken: 'invalid',
      ...(env.SINCH_REGION && { region: env.SINCH_REGION }),
    }),
    message: ({ text }) =>
      createChannelMessage({
        channel: 'sms',
        to: env.SINCH_TO,
        text,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      }),
  },
  {
    name: 'APNs',
    Transport: require('../../src/apns/index.js').ApnsTransport,
    // The key of the team (its .p8), the bundle id, and the token of a device
    // of the environment (sandbox for a build of Xcode).
    needs: ['APNS_TEAM_ID', 'APNS_KEY_ID', 'APNS_PRIVATE_KEY', 'APNS_TOPIC', 'APNS_DEVICE_TOKEN'],
    config: () => ({
      teamId: env.APNS_TEAM_ID,
      keyId: env.APNS_KEY_ID,
      privateKey: env.APNS_PRIVATE_KEY,
      topic: env.APNS_TOPIC,
      environment: env.APNS_ENVIRONMENT ?? 'sandbox',
    }),
    // The team and the key with a key Apple never issued.
    refused: () => ({
      teamId: env.APNS_TEAM_ID,
      keyId: env.APNS_KEY_ID,
      privateKey: require('node:crypto').generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
        .privateKey,
      topic: env.APNS_TOPIC,
      environment: env.APNS_ENVIRONMENT ?? 'sandbox',
    }),
    message: ({ text }) =>
      createChannelMessage({
        channel: 'push',
        to: { token: env.APNS_DEVICE_TOKEN },
        title: '@alexify/mailer',
        text,
      }),
  },
  {
    name: 'RBM',
    Transport: require('../../src/rbm/index.js').RbmTransport,
    // The service account of an agent, and a device of a tester it invited.
    needs: ['RBM_SERVICE_ACCOUNT', 'RBM_AGENT_ID', 'RBM_TO'],
    config: () => ({
      serviceAccount: JSON.parse(env.RBM_SERVICE_ACCOUNT),
      agentId: env.RBM_AGENT_ID,
      ...(env.RBM_REGION && { region: env.RBM_REGION }),
    }),
    // The account with a key Google never issued.
    refused: () => ({
      serviceAccount: {
        ...JSON.parse(env.RBM_SERVICE_ACCOUNT),
        private_key: require('node:crypto')
          .generateKeyPairSync('rsa', { modulusLength: 2048 })
          .privateKey.export({ type: 'pkcs8', format: 'pem' }),
      },
      agentId: env.RBM_AGENT_ID,
    }),
    message: ({ text, buttons, media }) =>
      createChannelMessage({ channel: 'rcs', to: env.RBM_TO, text, buttons, media }),
  },
  {
    name: 'Viber',
    Transport: require('../../src/viber/index.js').ViberTransport,
    // The token of a bot, and the id of a user subscribed to it.
    needs: ['VIBER_AUTH_TOKEN', 'VIBER_TO'],
    config: () => ({ authToken: env.VIBER_AUTH_TOKEN, sender: { name: 'mailer e2e' } }),
    refused: () => ({
      authToken: '445da6az1s345z78-dazcczb2542zv51a-e0vc5fva17480im9',
      sender: { name: 'mailer e2e' },
    }),
    message: ({ text, buttons, media }) =>
      createChannelMessage({ channel: 'viber', to: env.VIBER_TO, text, buttons, media }),
  },
  {
    name: 'Teams',
    Transport: require('../../src/teams/index.js').TeamsTransport,
    // The URL of a webhook of Workflows that posts to a channel.
    needs: ['TEAMS_WEBHOOK_URL'],
    config: () => ({ webhookUrl: env.TEAMS_WEBHOOK_URL }),
    // A workflow that does not exist: Azure refuses its signature.
    refused: () => ({ webhookUrl: env.TEAMS_WEBHOOK_URL.replace(/sig=[^&]+/, 'sig=invalid') }),
    message: ({ text, buttons, media }) =>
      createChannelMessage({ channel: 'teams', text, buttons, media }),
  },
  {
    name: 'Teams bot',
    Transport: require('../../src/teams/index.js').TeamsTransport,
    // The app of a bot, and a conversation it is in (from an activity it got).
    needs: ['TEAMS_APP_ID', 'TEAMS_CLIENT_SECRET', 'TEAMS_SERVICE_URL', 'TEAMS_CONVERSATION_ID'],
    config: () => ({
      bot: {
        appId: env.TEAMS_APP_ID,
        clientSecret: env.TEAMS_CLIENT_SECRET,
        ...(env.TEAMS_TENANT_ID && { tenantId: env.TEAMS_TENANT_ID }),
      },
    }),
    refused: () => ({
      bot: {
        appId: env.TEAMS_APP_ID,
        clientSecret: 'invalid',
        ...(env.TEAMS_TENANT_ID && { tenantId: env.TEAMS_TENANT_ID }),
      },
    }),
    message: ({ text, buttons, media }) =>
      createChannelMessage({
        channel: 'teams',
        to: { serviceUrl: env.TEAMS_SERVICE_URL, conversationId: env.TEAMS_CONVERSATION_ID },
        text,
        buttons,
        media,
      }),
  },
  {
    name: 'Google Chat',
    Transport: require('../../src/google-chat/index.js').GoogleChatTransport,
    // The URL of a webhook of a space.
    needs: ['GOOGLE_CHAT_WEBHOOK_URL'],
    config: () => ({ webhookUrl: env.GOOGLE_CHAT_WEBHOOK_URL }),
    refused: () => ({
      webhookUrl: env.GOOGLE_CHAT_WEBHOOK_URL.replace(/token=[^&]+/, 'token=invalid'),
    }),
    message: ({ text, buttons, media }) =>
      createChannelMessage({
        channel: 'google-chat',
        text,
        buttons: buttons?.filter((button) => button.type === 'url'),
        media,
      }),
  },
  {
    name: 'Google Chat app',
    Transport: require('../../src/google-chat/index.js').GoogleChatTransport,
    // The service account of a Chat app, and a space it was added to.
    needs: ['GOOGLE_CHAT_SERVICE_ACCOUNT', 'GOOGLE_CHAT_SPACE'],
    config: () => ({ serviceAccount: JSON.parse(env.GOOGLE_CHAT_SERVICE_ACCOUNT) }),
    refused: () => ({
      serviceAccount: {
        ...JSON.parse(env.GOOGLE_CHAT_SERVICE_ACCOUNT),
        private_key: require('node:crypto')
          .generateKeyPairSync('rsa', { modulusLength: 2048 })
          .privateKey.export({ type: 'pkcs8', format: 'pem' }),
      },
    }),
    message: ({ text, buttons, media }) =>
      createChannelMessage({
        channel: 'google-chat',
        to: env.GOOGLE_CHAT_SPACE,
        text,
        buttons: buttons?.filter((button) => button.type === 'url'),
        media,
      }),
  },
  {
    name: 'TurboSMS',
    Transport: require('../../src/turbosms/index.js').TurboSmsTransport,
    needs: ['TURBOSMS_TOKEN', 'TURBOSMS_SENDER', 'TURBOSMS_TO'],
    config: () => ({ token: env.TURBOSMS_TOKEN, sender: env.TURBOSMS_SENDER }),
    refused: () => ({ token: 'invalid', sender: env.TURBOSMS_SENDER }),
    message: ({ text }) => createChannelMessage({ channel: 'sms', to: env.TURBOSMS_TO, text }),
  },
  {
    name: 'Web Push',
    Transport: require('../../src/webpush/index.js').WebPushTransport,
    // The keys the browser subscribed with, and the JSON of its subscription.
    needs: ['WEBPUSH_VAPID_PUBLIC_KEY', 'WEBPUSH_VAPID_PRIVATE_KEY', 'WEBPUSH_SUBSCRIPTION'],
    config: () => ({
      vapid: {
        subject: 'mailto:e2e@example.com',
        publicKey: env.WEBPUSH_VAPID_PUBLIC_KEY,
        privateKey: env.WEBPUSH_VAPID_PRIVATE_KEY,
      },
    }),
    // Another pair: the push service refuses a JWT of a key the browser did
    // not subscribe with.
    refused: () => {
      const other = require('node:crypto').createECDH('prime256v1');
      other.generateKeys();
      return {
        vapid: {
          subject: 'mailto:e2e@example.com',
          publicKey: other.getPublicKey().toString('base64url'),
          privateKey: other.getPrivateKey().toString('base64url'),
        },
      };
    },
    message: ({ text, media }) =>
      createChannelMessage({
        channel: 'push',
        to: JSON.parse(env.WEBPUSH_SUBSCRIPTION),
        title: '@alexify/mailer',
        text,
        media: media?.slice(0, 1),
      }),
  },
];

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000));

const assertSent = (receipt) => {
  assert.equal(
    receipt.successful,
    true,
    receipt.successful ? undefined : receipt.errorMessages.join(', '),
  );
  assert.ok(receipt.messageId);
};

for (const provider of PROVIDERS) {
  const missing = provider.needs.filter((name) => !env[name]);
  const skip = missing.length > 0 ? `set ${missing.join(', ')}` : false;
  const text = `[E2E] ${provider.name}: a message of @alexify/mailer.`;

  test(`E2E ${provider.name}: a text`, { skip }, async () => {
    await pause();
    const receipt = await new provider.Transport(provider.config()).send(
      provider.message({ text }),
    );
    assertSent(receipt);
    console.log(`${provider.name} text: ${receipt.messageId}`);
  });

  test(`E2E ${provider.name}: a text with a button, and a medium by URL`, { skip }, async () => {
    await pause();
    const transport = new provider.Transport(provider.config());
    assertSent(
      await transport.send(
        provider.message({
          text: `${text} With a button.`,
          buttons: [
            { type: 'url', text: 'mailerat.vercel.app', url: 'https://mailerat.vercel.app/' },
          ],
        }),
      ),
    );
    await pause();
    assertSent(
      await transport.send(
        provider.message({
          text: `${text} With a picture.`,
          media: [{ url: 'https://mailerat.vercel.app/logo.png', contentType: 'image/png' }],
        }),
      ),
    );
  });

  test(`E2E ${provider.name}: two messages with sendMany`, { skip }, async () => {
    await pause();
    const transport = new provider.Transport(provider.config());
    const receipts = [];
    const batch = [
      provider.message({ text: `${text} 1` }),
      provider.message({ text: `${text} 2` }),
    ];
    for await (const receipt of transport.sendMany(batch)) receipts.push(receipt);
    assert.equal(receipts.length, 2);
    for (const receipt of receipts) assertSent(receipt);
  });

  test(`E2E ${provider.name}: verify() accepts the credentials`, { skip }, async () => {
    const transport = new provider.Transport(provider.config());
    if (typeof transport.verify !== 'function') return;
    await transport.verify();
  });

  test(`E2E ${provider.name}: refused credentials are an auth failure`, { skip }, async () => {
    await pause();
    const receipt = await new provider.Transport(provider.refused()).send(
      provider.message({ text }),
    );
    assert.equal(receipt.successful, false);
    assert.equal(receipt.retryable, false, receipt.errorMessages.join(', '));
    assert.equal(receipt.errors[0].category, 'auth', receipt.errorMessages.join(', '));
  });
}
