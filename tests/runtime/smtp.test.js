// Not ported: the SMTP transport on the runtime that runs the test (Node, Bun
// or Deno), with no mock: its sockets, TLS and DKIM against local servers.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('@alexify/mailer');
const { SmtpTransport, createHttpProxyConnector } = require('@alexify/mailer/smtp');
const { ca, proxyServer, smtpServer } = require('../helpers/smtp/servers.js');
const { verifyDkim } = require('../helpers/mime/verify-dkim.js');
const keys = require('../helpers/mime/dkim-test-keys.js');

const message = (subject = 'Grüße') =>
  createMessage({
    from: 'shop@example.com',
    to: ['bob@example.com', 'carol@bücher.de'],
    subject,
    content: { text: 'Line one\n.starts with a dot\n', html: '<p>Привіт</p>' },
    attachments: [new File(['report'], 'report.txt', { type: 'text/plain' })],
  });

const sendWith = async (config, messages) => {
  const transport = new SmtpTransport(config);
  try {
    const receipts = [];
    for (const each of messages) receipts.push(await transport.send(each));
    return receipts;
  } finally {
    await transport.closeAllConnections();
  }
};

test('Runtime SMTP: signed with RSA and Ed25519, over one pooled connection with AUTH', async (t) => {
  const { port, state } = await smtpServer(t);
  const signatures = [
    { privateKey: keys.TEST_DKIM_PRIVATE_KEY, publicKey: keys.TEST_DKIM_PUBLIC_KEY },
    {
      privateKey: keys.TEST_DKIM_ED25519_PRIVATE_KEY,
      publicKey: keys.TEST_DKIM_ED25519_PUBLIC_KEY,
      algorithm: 'ed25519-sha256',
    },
  ];
  for (const { privateKey, publicKey, algorithm } of signatures) {
    state.data.length = 0;
    const receipts = await sendWith(
      {
        host: '127.0.0.1',
        port,
        auth: { user: 'user', pass: 'pässword' },
        dkim: {
          signatures: [
            {
              signingDomain: keys.TEST_DKIM_DOMAIN,
              selector: keys.TEST_DKIM_SELECTOR,
              privateKey,
              algorithm,
            },
          ],
        },
      },
      [message('First'), message('Second')],
    );
    for (const receipt of receipts) {
      assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
    }
    assert.strictEqual(state.data.length, 2);
    for (const data of state.data) {
      assert.match(data, new RegExp(`DKIM-Signature: v=1; a=${algorithm ?? 'rsa-sha256'};`));
      assert.match(data, /\.starts with a dot/);
      verifyDkim(data, publicKey);
    }
  }
  // Two messages per pooled connection: one greeting and one AUTH each time.
  const ehlo = state.commands.filter((command) => command.startsWith('EHLO'));
  assert.strictEqual(ehlo.length, 2);
  assert.ok(state.commands.includes('RCPT TO:<carol@xn--bcher-kva.de>'));
});

test('Runtime SMTP: implicit TLS and STARTTLS trust the CA they are given', async (t) => {
  for (const mode of ['implicit', 'starttls']) {
    const { port, state } = await smtpServer(t, mode);
    const [receipt] = await sendWith(
      {
        host: 'localhost',
        port,
        secure: mode === 'implicit',
        requireTls: true,
        tls: { ca },
        auth: { user: 'user', pass: 'pass' },
      },
      [message()],
    );
    assert.strictEqual(receipt.successful, true, `${mode}: ${receipt.errorMessages?.join()}`);
    assert.strictEqual(state.messages, 1, mode);
    assert.ok(
      state.commands.some((command) => command.startsWith('AUTH PLAIN')),
      mode,
    );
  }
});

test('Runtime SMTP: a certificate of an unknown CA is a failure that is not retried', async (t) => {
  const { port, state } = await smtpServer(t, 'implicit');
  const [receipt] = await sendWith({ host: 'localhost', port, secure: true }, [message()]);
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.retryable, false, receipt.errorMessages.join());
  assert.strictEqual(receipt.deliveryUnknown, undefined);
  assert.strictEqual(state.commands.length, 0);
});

test('Runtime SMTP: the session goes through an HTTP CONNECT proxy', async (t) => {
  const { port, state } = await smtpServer(t, 'starttls');
  const proxy = await proxyServer(t);
  const [receipt] = await sendWith(
    {
      host: 'localhost',
      port,
      requireTls: true,
      tls: { ca },
      connect: createHttpProxyConnector({ url: proxy.url }),
    },
    [message()],
  );
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
  assert.strictEqual(state.messages, 1);
  assert.strictEqual(proxy.requests[0].url, `localhost:${port}`);
});
