// Not ported: the A-label of a domain beyond ASCII, written into header
// fields, SMTP envelopes, JMAP and provider requests (nodemailer converts it,
// upyo wrote the domain as given and asked for SMTPUTF8).
const { test } = require('node:test');
const assert = require('node:assert');
const { domainToUnicode } = require('node:url');
const PostalMime = require('postal-mime');
const { createMessage } = require('../../index.js');
const { toAsciiAddress } = require('../../src/core/address.js');
const { readAttachmentContent } = require('../../src/core/attachment.js');
const { composeMessage } = require('../../src/mime/index.js');
const { SmtpTransport } = require('../../src/smtp/index.js');
const { convertMessage: convertSendGrid } = require('../../src/sendgrid/message-converter.js');
const { createSendGridConfig } = require('../../src/sendgrid/config.js');
const { formatAddress: formatJmapAddress } = require('../../src/jmap/message-converter.js');
const { convertMessage: convertPlunk } = require('../../src/plunk/message-converter.js');
const { MockSmtpServer } = require('../helpers/smtp/mock-smtp-server.js');

test('IDN: a domain beyond ASCII under an ASCII local part becomes its A-label', () => {
  assert.strictEqual(toAsciiAddress('user@bücher.de'), 'user@xn--bcher-kva.de');
  assert.strictEqual(toAsciiAddress('support@例え.テスト'), 'support@xn--r8jz45g.xn--zckzah');
  assert.strictEqual(toAsciiAddress('info@пример.рф'), 'info@xn--e1afmkfd.xn--p1ai');
  assert.strictEqual(toAsciiAddress('"a@b"@bücher.de'), '"a@b"@xn--bcher-kva.de');
  // UTS #46 maps as browsers and resolvers do: a soft hyphen is ignored, so
  // the domain mailed is the one a validator reads.
  assert.strictEqual(toAsciiAddress('user@compa­ny.com'), 'user@company.com');
});

test('IDN: ASCII, a local part beyond ASCII and address literals stay as given', () => {
  assert.strictEqual(toAsciiAddress('User@Example.COM'), 'User@Example.COM');
  assert.strictEqual(toAsciiAddress('josé@bücher.de'), 'josé@bücher.de');
  assert.strictEqual(toAsciiAddress('用户@例子.广告'), '用户@例子.广告');
  assert.strictEqual(toAsciiAddress('user@[192.0.2.1]'), 'user@[192.0.2.1]');
  assert.strictEqual(toAsciiAddress('no-at-sign-ü'), 'no-at-sign-ü');
});

test('IDN: a domain the URL parser would cut is left as it is', () => {
  // domainToASCII('bücher.de/evil.example') gives 'xn--bcher-kva.de', which
  // would mail a domain the sender never named.
  assert.strictEqual(toAsciiAddress('user@bücher.de/evil.example'), 'user@bücher.de/evil.example');
  assert.strictEqual(toAsciiAddress('user@bücher.de?x'), 'user@bücher.de?x');
  assert.strictEqual(toAsciiAddress('user@bü%63her.de'), 'user@bü%63her.de');
});

const idnMessage = () =>
  createMessage({
    from: { name: 'Jörg', address: 'jorg@bücher.de' },
    to: 'leser@例え.テスト',
    cc: 'info@пример.рф',
    bcc: 'blind@bücher.de',
    replyTo: 'support@bücher.de',
    subject: 'Bücher',
    content: { text: 'Hallo' },
  });

test('IDN: composeMessage writes A-labels into the header fields and the envelope', async () => {
  const message = idnMessage();
  // The message keeps the addresses as the application gave them.
  assert.strictEqual(message.recipients[0].address, 'leser@例え.テスト');
  const raw = await composeMessage(message);
  assert.deepStrictEqual(raw.envelope, {
    from: 'jorg@xn--bcher-kva.de',
    to: ['leser@xn--r8jz45g.xn--zckzah', 'info@xn--e1afmkfd.xn--p1ai', 'blind@xn--bcher-kva.de'],
  });
  assert.strictEqual(raw.encoding, '7bit');
  const bytes = await readAttachmentContent(raw.content);
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /^To: leser@xn--r8jz45g\.xn--zckzah\r$/m);
  const parsed = await PostalMime.parse(bytes);
  assert.strictEqual(parsed.from.address, 'jorg@xn--bcher-kva.de');
  assert.strictEqual(parsed.from.name, 'Jörg');
  assert.strictEqual(domainToUnicode(parsed.to[0].address.split('@')[1]), '例え.テスト');
  assert.strictEqual(parsed.cc[0].address, 'info@xn--e1afmkfd.xn--p1ai');
  assert.strictEqual(parsed.replyTo[0].address, 'support@xn--bcher-kva.de');
});

test('IDN: SMTP sends to a domain beyond ASCII to a server without SMTPUTF8', async () => {
  const server = new MockSmtpServer();
  const port = await server.start();
  try {
    const transport = new SmtpTransport({ host: 'localhost', port, pool: false });
    const receipt = await transport.send(idnMessage());
    assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
    const commands = server.getReceivedCommands();
    assert.ok(commands.includes('MAIL FROM:<jorg@xn--bcher-kva.de>'), commands.join('\n'));
    assert.ok(commands.includes('RCPT TO:<leser@xn--r8jz45g.xn--zckzah>'));
    assert.ok(commands.includes('RCPT TO:<blind@xn--bcher-kva.de>'));
  } finally {
    await server.stop();
  }
});

test('IDN: an envelope override and a raw message go as A-labels too', async () => {
  const server = new MockSmtpServer();
  const port = await server.start();
  try {
    const transport = new SmtpTransport({ host: 'localhost', port, pool: false });
    const overridden = await transport.send(idnMessage(), {
      envelope: { from: 'bounce@bücher.de', to: ['other@bücher.de'] },
    });
    assert.strictEqual(overridden.successful, true, overridden.errorMessages?.join());
    const raw = await transport.sendRaw({
      envelope: { from: 'a@bücher.de', to: ['b@пример.рф'] },
      content: new TextEncoder().encode(
        'From: a@xn--bcher-kva.de\r\nTo: b@xn--e1afmkfd.xn--p1ai\r\n\r\nHi\r\n',
      ),
    });
    assert.strictEqual(raw.successful, true, raw.errorMessages?.join());
    const commands = server.getReceivedCommands();
    assert.ok(commands.includes('MAIL FROM:<bounce@xn--bcher-kva.de>'), commands.join('\n'));
    assert.ok(commands.includes('RCPT TO:<other@xn--bcher-kva.de>'));
    assert.ok(commands.includes('MAIL FROM:<a@xn--bcher-kva.de>'));
    assert.ok(commands.includes('RCPT TO:<b@xn--e1afmkfd.xn--p1ai>'));
  } finally {
    await server.stop();
  }
});

test('IDN: a local part beyond ASCII still asks for SMTPUTF8', async () => {
  const server = new MockSmtpServer();
  const port = await server.start();
  try {
    const transport = new SmtpTransport({ host: 'localhost', port, pool: false });
    const receipt = await transport.send(
      createMessage({
        from: 'a@example.com',
        to: 'josé@bücher.de',
        subject: 'S',
        content: { text: 'T' },
      }),
    );
    assert.strictEqual(receipt.successful, false);
    assert.match(receipt.errorMessages.join(), /SMTPUTF8/);
  } finally {
    await server.stop();
  }
});

test('IDN: providers and JMAP get the A-label', async () => {
  const message = idnMessage();
  const sendgrid = await convertSendGrid(message, createSendGridConfig({ apiKey: 'key' }));
  assert.strictEqual(sendgrid.from.email, 'jorg@xn--bcher-kva.de');
  assert.strictEqual(sendgrid.personalizations[0].to[0].email, 'leser@xn--r8jz45g.xn--zckzah');
  const plunk = await convertPlunk(message, {});
  assert.strictEqual(plunk.to, 'leser@xn--r8jz45g.xn--zckzah');
  assert.strictEqual(plunk.from, 'jorg@xn--bcher-kva.de');
  assert.deepStrictEqual(formatJmapAddress({ address: 'leser@例え.テスト' }), {
    email: 'leser@xn--r8jz45g.xn--zckzah',
  });
});
