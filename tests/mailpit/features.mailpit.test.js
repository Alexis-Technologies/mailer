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

test('Mailpit: a message goes through an HTTP CONNECT proxy', { skip }, async (t) => {
  const http = require('node:http');
  const net = require('node:net');
  const { createHttpProxyConnector } = require('../../src/smtp/index.js');
  const tunnels = new Set();
  let connects = 0;
  const proxy = http.createServer();
  proxy.on('connect', (request, client, head) => {
    connects++;
    tunnels.add(client);
    const [host, port] = [
      request.url.slice(0, request.url.lastIndexOf(':')),
      request.url.slice(request.url.lastIndexOf(':') + 1),
    ];
    const upstream = net.connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    for (const tunnel of tunnels) tunnel.destroy();
    proxy.close();
  });
  const { delivered } = await deliver(
    createMessage({
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 'Through a proxy',
      content: { text: 'Tunneled' },
    }),
    { connect: createHttpProxyConnector({ url: `http://127.0.0.1:${proxy.address().port}` }) },
  );
  assert.equal(connects, 1);
  assert.equal(delivered.Text.trim(), 'Tunneled');
});

// MAILPIT_SENDMAIL, such as "docker exec -i mailer-mailpit /mailpit sendmail",
// runs Mailpit's own sendmail in its container.
const sendmailCommand = process.env.MAILPIT_SENDMAIL;

test(
  'Mailpit: sendmail delivers through mailpit sendmail',
  { skip: skip || !sendmailCommand },
  async () => {
    const childProcess = require('node:child_process');
    const { SendmailTransport } = require('../../src/sendmail/index.js');
    const [command, ...prefix] = sendmailCommand.split(' ');
    const transport = new SendmailTransport({
      spawn: (path, args, options) => childProcess.spawn(command, [...prefix, ...args], options),
    });
    const config = getTestConfig();
    const client = new MailpitClient(config.mailpit);
    await client.deleteAllMessages();
    const receipt = await transport.send(
      createMessage({
        from: 'app@example.com',
        to: 'user@example.com',
        bcc: 'archive@example.com',
        subject: 'Through sendmail',
        content: { text: 'Piped' },
      }),
    );
    assert.ok(receipt.successful, JSON.stringify(receipt));
    const delivered = await waitForMailpitDelivery(client, { subject: 'Through sendmail' });
    assert.equal(delivered.Text.trim(), 'Piped');
    assert.deepEqual(
      delivered.Bcc.map((address) => address.Address),
      ['archive@example.com'],
    );
    // Mailpit writes a Bcc field of its own into what it stores, from the
    // envelope; that the message has none is a unit test of ./sendmail.
  },
);
