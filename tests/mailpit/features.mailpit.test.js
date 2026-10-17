// Not ported: the message features of 1.1 against a real SMTP server, Mailpit,
// which also checks List-Unsubscribe and List-Unsubscribe-Post itself.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMessage } = require('../../index.js');
const { SmtpTransport } = require('../../src/smtp/index.js');
const { fromDataUri } = require('../../src/attachments/index.js');
const { MailpitClient } = require('../helpers/smtp/mailpit-client.js');
const { waitForMailpitDelivery } = require('../helpers/smtp/mailpit-delivery-utils.js');
const { getTestConfig, isMailpitTestingEnabled } = require('../helpers/smtp/test-config.js');
const {
  TEST_DKIM_PRIVATE_KEY,
  TEST_DKIM_PUBLIC_KEY,
} = require('../helpers/mime/dkim-test-keys.js');
const { verifyDkim } = require('../helpers/mime/verify-dkim.js');

const skip = !isMailpitTestingEnabled();

const deliver = async (message, smtp = {}) => {
  const config = getTestConfig();
  const client = new MailpitClient(config.mailpit);
  await client.deleteAllMessages();
  const transport = new SmtpTransport({ ...config.smtp, ...smtp });
  try {
    const receipt = await transport.send(message);
    assert.ok(receipt.successful, JSON.stringify(receipt));
  } finally {
    await transport.closeAllConnections();
  }
  const delivered = await waitForMailpitDelivery(client, { subject: message.subject });
  return { delivered, source: await client.getMessageSource(delivered.ID) };
};

test('Mailpit: a Unicode domain arrives as its A-label', { skip }, async () => {
  const { delivered, source } = await deliver(
    createMessage({
      from: { name: 'Jörg', address: 'jorg@bücher.de' },
      to: 'leser@bücher.de',
      subject: 'IDN A-label',
      content: { text: 'Hallo' },
    }),
  );
  assert.equal(delivered.From.Address, 'jorg@xn--bcher-kva.de');
  assert.equal(delivered.From.Name, 'Jörg');
  assert.equal(delivered.To[0].Address, 'leser@xn--bcher-kva.de');
  assert.match(source, /^To: leser@xn--bcher-kva\.de\r$/m);
});

test('Mailpit: one-click List-Unsubscribe passes its check, under DKIM', { skip }, async () => {
  const { delivered, source } = await deliver(
    createMessage({
      from: 'news@example.com',
      to: 'reader@example.com',
      subject: 'List-Unsubscribe one-click',
      content: { html: '<p>Weekly</p>', text: 'Weekly' },
      list: {
        id: { id: 'news.example.com', name: 'Weekly News' },
        unsubscribe: ['https://example.com/unsubscribe?u=42', 'unsubscribe@example.com'],
        oneClick: true,
      },
    }),
    {
      dkim: {
        signatures: [
          { signingDomain: 'example.com', selector: 'test', privateKey: TEST_DKIM_PRIVATE_KEY },
        ],
      },
    },
  );
  const check = delivered.ListUnsubscribe;
  assert.equal(check.Errors, '', JSON.stringify(check));
  assert.equal(check.HeaderPost, 'List-Unsubscribe=One-Click');
  assert.deepEqual(check.Links, [
    'https://example.com/unsubscribe?u=42',
    'mailto:unsubscribe@example.com',
  ]);
  verifyDkim(source, TEST_DKIM_PUBLIC_KEY);
  assert.match(source, /h=[^;]*list-unsubscribe:list-unsubscribe-post;/);
});

test(
  'Mailpit: each text body arrives as it was written, whatever its encoding',
  { skip },
  async () => {
    const text = 'Серце має свої причини, яких розум не знає.\r\nLe cœur a ses raisons.';
    const html = '<p>Short ASCII</p>';
    const { delivered, source } = await deliver(
      createMessage({
        from: 'a@example.com',
        to: 'b@example.com',
        subject: 'Encodings',
        content: { text, html },
        attachments: fromDataUri('data:text/csv,a%2Cb', { filename: 'data.csv' }),
      }),
    );
    assert.match(source, /Content-Transfer-Encoding: base64/);
    assert.match(source, /Content-Transfer-Encoding: 7bit/);
    assert.equal(delivered.Text.replace(/\r\n/g, '\n').trim(), text.replace(/\r\n/g, '\n'));
    assert.equal(delivered.HTML.trim(), html);
    assert.equal(delivered.Attachments[0].FileName, 'data.csv');
  },
);
