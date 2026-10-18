// Not ported: the name EHLO gives by default, after nodemailer's
// `_getHostname`, where upyo gave `localhost`.
const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const { createMessage } = require('../../index.js');
const { SmtpTransport } = require('../../src/smtp/index.js');
const { defaultLocalName } = require('../../src/smtp/config.js');
const { MockSmtpServer } = require('../helpers/smtp/mock-smtp-server.js');

test('EHLO: the host name of this machine when it is fully qualified', (t) => {
  const names = [
    ['mail.example.com', 'mail.example.com'],
    ['mail.example.com.', 'mail.example.com'],
    ['host-1.eu.example.org', 'host-1.eu.example.org'],
    ['my-laptop', '[127.0.0.1]'],
    ['bad_name.local', '[127.0.0.1]'],
    ['-dash.example.com', '[127.0.0.1]'],
    ['', '[127.0.0.1]'],
    ['192.0.2.7', '[192.0.2.7]'],
    ['2001:db8::7', '[IPv6:2001:db8::7]'],
  ];
  const hostname = t.mock.method(os, 'hostname', () => '');
  for (const [name, expected] of names) {
    hostname.mock.mockImplementation(() => name);
    assert.strictEqual(defaultLocalName(), expected, name);
  }
  hostname.mock.mockImplementation(() => {
    throw new Error('uv_os_gethostname');
  });
  assert.strictEqual(defaultLocalName(), '[127.0.0.1]');
});

test('EHLO: the transport greets with that name, or with localName', async (t) => {
  t.mock.method(os, 'hostname', () => 'relay.example.net');
  const server = new MockSmtpServer();
  const port = await server.start();
  const message = createMessage({
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 'Hi',
    content: { text: 'Hi' },
  });
  try {
    for (const localName of [undefined, 'sender.example.com']) {
      const transport = new SmtpTransport({ host: 'localhost', port, pool: false, localName });
      const receipt = await transport.send(message);
      assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
    }
    const greetings = server.getReceivedCommands().filter((command) => command.startsWith('EHLO'));
    assert.deepStrictEqual(greetings, ['EHLO relay.example.net', 'EHLO sender.example.com']);
  } finally {
    await server.stop();
  }
});

test('EHLO: a localName that would end the command is refused', () => {
  for (const localName of ['a\r\nQUIT', 'two words', '', 42]) {
    assert.throws(() => new SmtpTransport({ host: 'localhost', localName }), /Invalid localName/);
  }
});
