// Not ported: `maxMessages`, the messages one SMTP connection sends before a
// new one is opened, after nodemailer's pool (upyo reused a connection
// without a limit).
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { SmtpTransport } = require('../../src/smtp/index.js');
const { MockSmtpServer } = require('../helpers/smtp/mock-smtp-server.js');

const message = (index) =>
  createMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: `Message ${index}`,
    content: { text: 'Hi' },
  });
const messages = (count) => {
  const list = [];
  for (let i = 0; i < count; i++) list.push(message(i));
  return list;
};

const withServer = async (run) => {
  const server = new MockSmtpServer();
  const port = await server.start();
  try {
    await run(server, port);
  } finally {
    await server.stop();
  }
};

const quits = (server) => server.getReceivedCommands().filter((c) => c === 'QUIT').length;

test('maxMessages: send() opens a new connection after so many messages', async () => {
  await withServer(async (server, port) => {
    const transport = new SmtpTransport({ host: 'localhost', port, poolSize: 1, maxMessages: 2 });
    for (const each of messages(5)) {
      const receipt = await transport.send(each);
      assert.strictEqual(receipt.successful, true);
    }
    await transport.closeAllConnections();
    assert.strictEqual(server.getConnectionCount(), 3);
    // The two that reached the limit are closed with QUIT.
    assert.ok(quits(server) >= 2);
  });
});

test('maxMessages: sendMany() changes connection within a batch, in order', async () => {
  await withServer(async (server, port) => {
    const transport = new SmtpTransport({ host: 'localhost', port, maxMessages: 2 });
    const receipts = [];
    for await (const receipt of transport.sendMany(messages(5))) receipts.push(receipt);
    await transport.closeAllConnections();
    assert.deepStrictEqual(
      receipts.map((receipt) => receipt.successful),
      [true, true, true, true, true],
    );
    assert.strictEqual(server.getConnectionCount(), 3);
    assert.strictEqual(server.getReceivedMessages().length, 5);
  });
});

test('maxMessages: a refused message counts, and 100 is the default', async () => {
  await withServer(async (server, port) => {
    // A message the connection refuses, keeping it usable: the server offers
    // no SMTPUTF8 for this address.
    const refused = createMessage({
      from: 'a@example.com',
      to: 'josé@example.com',
      subject: 'Refused',
      content: { text: 'Hi' },
    });
    const transport = new SmtpTransport({ host: 'localhost', port, maxMessages: 2 });
    const receipts = [];
    for await (const receipt of transport.sendMany([refused, message(1), message(2)])) {
      receipts.push(receipt);
    }
    await transport.closeAllConnections();
    assert.deepStrictEqual(
      receipts.map((receipt) => receipt.successful),
      [false, true, true],
    );
    assert.strictEqual(server.getConnectionCount(), 2);
  });
  await withServer(async (server, port) => {
    const transport = new SmtpTransport({ host: 'localhost', port });
    for await (const receipt of transport.sendMany(messages(101))) {
      assert.strictEqual(receipt.successful, true);
    }
    await transport.closeAllConnections();
    assert.strictEqual(server.getConnectionCount(), 2);
  });
});

test('maxMessages: Infinity keeps the connection, an invalid value is refused', async () => {
  await withServer(async (server, port) => {
    const transport = new SmtpTransport({ host: 'localhost', port, maxMessages: Infinity });
    for await (const receipt of transport.sendMany(messages(3))) {
      assert.strictEqual(receipt.successful, true);
    }
    await transport.closeAllConnections();
    assert.strictEqual(server.getConnectionCount(), 1);
  });
  for (const maxMessages of [0, -1, 1.5, '10', Number.NaN]) {
    assert.throws(
      () => new SmtpTransport({ host: 'localhost', maxMessages }),
      /maxMessages must be a positive whole number/,
    );
  }
});
