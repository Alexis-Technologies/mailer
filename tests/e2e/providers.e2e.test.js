// Not ported: the providers of 1.1 against their real APIs, each skipped until
// its variables are set: <PROVIDER>_FROM and <PROVIDER>_TO, a verified sender
// and a recipient, and the credentials named in its row below.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMessage } = require('../../src/index.js');

const env = process.env;

// Each provider: its transport, the variables it needs, its configuration
// from them, and one whose credentials the provider refuses.
const PROVIDERS = [
  {
    name: 'Postmark',
    prefix: 'POSTMARK',
    Transport: require('../../src/postmark/index.js').PostmarkTransport,
    needs: ['POSTMARK_SERVER_TOKEN'],
    config: () => ({
      serverToken: env.POSTMARK_SERVER_TOKEN,
      ...(env.POSTMARK_MESSAGE_STREAM && { messageStream: env.POSTMARK_MESSAGE_STREAM }),
    }),
    refused: () => ({ serverToken: '00000000-0000-0000-0000-000000000000' }),
  },
  {
    name: 'Brevo',
    prefix: 'BREVO',
    Transport: require('../../src/brevo/index.js').BrevoTransport,
    needs: ['BREVO_API_KEY'],
    config: () => ({ apiKey: env.BREVO_API_KEY }),
    refused: () => ({ apiKey: 'xkeysib-invalid' }),
  },
  {
    name: 'Mailjet',
    prefix: 'MAILJET',
    Transport: require('../../src/mailjet/index.js').MailjetTransport,
    needs: ['MAILJET_API_KEY', 'MAILJET_API_SECRET'],
    config: () => ({ apiKey: env.MAILJET_API_KEY, apiSecret: env.MAILJET_API_SECRET }),
    refused: () => ({ apiKey: env.MAILJET_API_KEY, apiSecret: 'invalid' }),
  },
  {
    name: 'MailerSend',
    prefix: 'MAILERSEND',
    Transport: require('../../src/mailersend/index.js').MailerSendTransport,
    needs: ['MAILERSEND_API_KEY'],
    config: () => ({ apiKey: env.MAILERSEND_API_KEY }),
    refused: () => ({ apiKey: 'mlsn.invalid' }),
  },
  {
    name: 'SparkPost',
    prefix: 'SPARKPOST',
    Transport: require('../../src/sparkpost/index.js').SparkPostTransport,
    needs: ['SPARKPOST_API_KEY'],
    config: () => ({
      apiKey: env.SPARKPOST_API_KEY,
      ...(env.SPARKPOST_REGION && { region: env.SPARKPOST_REGION }),
    }),
    refused: () => ({
      apiKey: 'invalid',
      ...(env.SPARKPOST_REGION && { region: env.SPARKPOST_REGION }),
    }),
  },
  {
    name: 'ZeptoMail',
    prefix: 'ZEPTOMAIL',
    Transport: require('../../src/zeptomail/index.js').ZeptoMailTransport,
    needs: ['ZEPTOMAIL_TOKEN'],
    config: () => ({
      token: env.ZEPTOMAIL_TOKEN,
      ...(env.ZEPTOMAIL_BOUNCE_ADDRESS && { bounceAddress: env.ZEPTOMAIL_BOUNCE_ADDRESS }),
    }),
    refused: () => ({ token: 'Zoho-enczapikey invalid' }),
  },
  {
    name: 'SMTP2GO',
    prefix: 'SMTP2GO',
    Transport: require('../../src/smtp2go/index.js').Smtp2goTransport,
    needs: ['SMTP2GO_API_KEY'],
    config: () => ({
      apiKey: env.SMTP2GO_API_KEY,
      ...(env.SMTP2GO_REGION && { region: env.SMTP2GO_REGION }),
    }),
    refused: () => ({ apiKey: 'api-00000000000000000000000000000000' }),
  },
  {
    name: 'Azure',
    prefix: 'AZURE',
    Transport: require('../../src/azure/index.js').AzureTransport,
    needs: ['AZURE_CONNECTION_STRING'],
    config: () => ({ connectionString: env.AZURE_CONNECTION_STRING }),
    refused: () => ({
      connectionString: env.AZURE_CONNECTION_STRING.replace(
        /accesskey=[^;]*/i,
        `accesskey=${Buffer.from('invalid').toString('base64')}`,
      ),
    }),
  },
  {
    name: 'Scaleway',
    prefix: 'SCALEWAY',
    Transport: require('../../src/scaleway/index.js').ScalewayTransport,
    needs: ['SCALEWAY_SECRET_KEY', 'SCALEWAY_PROJECT_ID'],
    config: () => ({
      secretKey: env.SCALEWAY_SECRET_KEY,
      projectId: env.SCALEWAY_PROJECT_ID,
      ...(env.SCALEWAY_REGION && { region: env.SCALEWAY_REGION }),
    }),
    refused: () => ({
      secretKey: '00000000-0000-0000-0000-000000000000',
      projectId: env.SCALEWAY_PROJECT_ID,
      ...(env.SCALEWAY_REGION && { region: env.SCALEWAY_REGION }),
    }),
  },
  {
    name: 'Cloudflare',
    prefix: 'CLOUDFLARE',
    Transport: require('../../src/cloudflare/index.js').CloudflareTransport,
    needs: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
    config: () => ({ accountId: env.CLOUDFLARE_ACCOUNT_ID, apiToken: env.CLOUDFLARE_API_TOKEN }),
    refused: () => ({ accountId: env.CLOUDFLARE_ACCOUNT_ID, apiToken: 'invalid' }),
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
  const needs = [...provider.needs, `${provider.prefix}_FROM`, `${provider.prefix}_TO`];
  const missing = needs.filter((name) => !env[name]);
  const skip = missing.length > 0 ? `set ${missing.join(', ')}` : false;
  const message = (fields) =>
    createMessage({
      from: { name: 'mailer E2E', address: env[`${provider.prefix}_FROM`] },
      to: env[`${provider.prefix}_TO`],
      subject: `[E2E] ${provider.name}`,
      content: { text: `This is a ${provider.name} E2E test email of @alexify/mailer.` },
      tags: ['mailer-e2e'],
      ...fields,
    });

  test(`E2E ${provider.name}: a text email`, { skip }, async () => {
    await pause();
    const receipt = await new provider.Transport(provider.config()).send(message({}));
    assertSent(receipt);
    console.log(`${provider.name} text email: ${receipt.messageId}`);
  });

  test(`E2E ${provider.name}: an HTML email with an attachment`, { skip }, async () => {
    await pause();
    const receipt = await new provider.Transport(provider.config()).send(
      message({
        subject: `[E2E] ${provider.name} HTML and attachment`,
        content: {
          html: `<h1>${provider.name}</h1><p>An E2E test with a file.</p>`,
          text: `${provider.name}\n\nAn E2E test with a file.`,
        },
        attachments: [
          {
            filename: 'mailer-e2e.txt',
            contentType: 'text/plain',
            content: new TextEncoder().encode('Attached by the mailer E2E test.'),
          },
        ],
      }),
    );
    assertSent(receipt);
    console.log(`${provider.name} HTML email: ${receipt.messageId}`);
  });

  test(`E2E ${provider.name}: two emails with sendMany`, { skip }, async () => {
    await pause();
    const transport = new provider.Transport(provider.config());
    const receipts = [];
    const batch = [message({ subject: '[E2E] batch 1' }), message({ subject: '[E2E] batch 2' })];
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
    const receipt = await new provider.Transport(provider.refused()).send(message({}));
    assert.equal(receipt.successful, false);
    assert.equal(receipt.retryable, false, receipt.errorMessages.join(', '));
    assert.equal(receipt.errors[0].category, 'auth', receipt.errorMessages.join(', '));
  });
}
