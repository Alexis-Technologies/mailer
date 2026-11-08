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
    await new provider.Transport(provider.config()).verify();
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
