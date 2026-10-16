// Paths of the ported DKIM signer (src/mime/dkim/) that upstream's suites leave
// out. A signature is verified with node:crypto over an input built here by
// hand from the wire headers, not with the signer's own canonicalization.
const { test } = require('node:test');
const assert = require('node:assert');
const { createHash, verify } = require('node:crypto');
const {
  TEST_DKIM_DOMAIN,
  TEST_DKIM_PRIVATE_KEY,
  TEST_DKIM_PUBLIC_KEY,
  TEST_DKIM_SELECTOR,
} = require('../helpers/mime/dkim-test-keys.js');
const { signMessage } = require('../helpers/mime/dkim-reference.js');

const config = (extra) => ({
  signingDomain: TEST_DKIM_DOMAIN,
  selector: TEST_DKIM_SELECTOR,
  privateKey: TEST_DKIM_PRIVATE_KEY,
  ...extra,
});

// Whether an RSA signature with relaxed header canonicalization verifies over
// `wire`, the header lines a receiver sees: a small verifier of its own that
// reads h= from the signature and takes the instances of each name from the
// bottom up (RFC 6376 §5.4.2), with relaxed canonicalization (§3.4.2).
const verifies = (result, wire) => {
  const signature = /(?:^|;\s*)b=([^;]+)$/.exec(result.signature)[1];
  const unsigned = result.signature.slice(0, -signature.length);
  const names = /(?:^|;\s*)h=([^;]+);/.exec(result.signature)[1].split(':');
  const fields = wire.map((line) => {
    const colon = line.indexOf(':');
    return [
      line.slice(0, colon).trim().toLowerCase(),
      line
        .slice(colon + 1)
        .replace(/\s+/g, ' ')
        .trim(),
    ];
  });
  const used = new Set();
  const signed = [];
  for (const name of names) {
    for (let i = fields.length - 1; i >= 0; i--) {
      if (fields[i][0] === name.toLowerCase() && !used.has(i)) {
        used.add(i);
        signed.push(`${fields[i][0]}:${fields[i][1]}`);
        break;
      }
    }
  }
  const input = [...signed, `dkim-signature:${unsigned.trim()}`].join('\r\n');
  return verify(
    'RSA-SHA256',
    Buffer.from(input),
    TEST_DKIM_PUBLIC_KEY,
    Buffer.from(signature, 'base64'),
  );
};

test('DKIM: h= signs the instances of a field from the bottom up, and over-signs', async () => {
  const raw =
    'From: alex@example.com\r\n' +
    'X-Tag: one\r\n' +
    'Subject: Hello\r\n' +
    'X-Tag: two\r\n' +
    '\r\n' +
    'Hi\r\n';
  const result = await signMessage(
    raw,
    config({ headerFields: ['from', 'x-tag', 'x-tag', 'x-tag', 'subject', 'subject'] }),
  );
  assert.ok(result.signature.includes('h=from:x-tag:x-tag:x-tag:subject:subject;'));
  assert.ok(
    result.signature.includes(`bh=${createHash('sha256').update('Hi\r\n').digest('base64')};`),
  );
  const wire = ['From: alex@example.com', 'X-Tag: one', 'Subject: Hello', 'X-Tag: two'];
  assert.strictEqual(verifies(result, wire), true);
  // The third x-tag has no instance left, so a third cannot be added.
  assert.strictEqual(verifies(result, [...wire, 'X-Tag: three']), false);
});

test('DKIM: by default, a forged Reply-To or a second From breaks the signature', async () => {
  const headers = [
    'From: alex@example.com',
    'To: bob@example.com',
    'Subject: Hello',
    'Date: Thu, 01 Jan 2026 00:00:00 +0000',
    'Message-ID: <1@example.com>',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
  ];
  const result = await signMessage(`${headers.join('\r\n')}\r\n\r\nHi\r\n`, config());
  assert.strictEqual(verifies(result, headers), true);
  // Fields a client shows, added after signing, now break the signature.
  for (const forged of [
    'Reply-To: eve@evil.example',
    'From: eve@evil.example',
    'Cc: eve@evil.example',
  ]) {
    assert.strictEqual(verifies(result, [forged, ...headers]), false, forged);
  }
});

test('DKIM: a domain, selector or field name that could break the signature field is refused', async () => {
  const { composeMessage } = require('../../src/mime/index.js');
  const { SmtpTransport } = require('../../src/smtp/index.js');
  const { createMessage } = require('../../index.js');
  const message = createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Hello',
    content: { text: 'Hi' },
  });
  const wrong = [
    { signingDomain: 'example.com\r\nBcc: eve@evil.example' },
    { signingDomain: 'example.com; x=1' },
    { signingDomain: '-example.com' },
    { selector: 'mail\r\nX: y' },
    { selector: 'a;b' },
    { headerFields: ['from', 'subject; x=1'] },
    { headerFields: ['from:to'] },
    { algorithm: 'rsa-sha1' },
    { canonicalization: 'relaxed' },
  ];
  for (const extra of wrong) {
    const signatures = [config(extra)];
    await assert.rejects(composeMessage(message, { dkim: { signatures } }), TypeError);
    // The SMTP transport refuses it when it is made, before any message.
    assert.throws(() => new SmtpTransport({ host: 'localhost', dkim: { signatures } }), TypeError);
  }
  // An internationalized domain may stay in U-labels (RFC 8616).
  await composeMessage(message, {
    dkim: { signatures: [config({ signingDomain: 'приклад.укр' })] },
  });
});

test('DKIM: a PKCS#1 key (BEGIN RSA PRIVATE KEY) signs like a PKCS#8 one', async () => {
  const { generateKeyPairSync } = require('node:crypto');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  assert.match(privateKey, /^-----BEGIN RSA PRIVATE KEY-----/);
  const result = await signMessage(
    'From: alex@example.com\r\nSubject: Hello\r\n\r\nHi\r\n',
    config({ privateKey, headerFields: ['from', 'subject'] }),
  );
  const signature = /(?:^|;\s*)b=([^;]+)$/.exec(result.signature)[1];
  const unsigned = result.signature.slice(0, -signature.length);
  const input = ['from:alex@example.com', 'subject:Hello', `dkim-signature:${unsigned.trim()}`];
  assert.ok(
    verify(
      'RSA-SHA256',
      Buffer.from(input.join('\r\n')),
      publicKey,
      Buffer.from(signature, 'base64'),
    ),
  );
  await assert.rejects(signMessage('From: a@example.com\r\n\r\n', config({ privateKey: 'nope' })), {
    message: /^Failed to import private key/,
  });
});

test('DKIM: a PEM key is imported once per configuration, and a broken one fails early', async (t) => {
  const { composeMessage } = require('../../src/mime/index.js');
  const { SmtpTransport } = require('../../src/smtp/index.js');
  const { createMessage, readAttachmentContent } = require('../../index.js');
  const importKey = t.mock.method(crypto.subtle, 'importKey');
  const dkim = { signatures: [config()] };
  for (let i = 0; i < 3; i++) {
    const composed = await composeMessage(
      createMessage({
        from: 'alex@example.com',
        to: 'bob@example.com',
        subject: 'Hello',
        content: { text: `${i}` },
      }),
      { dkim },
    );
    await readAttachmentContent(composed.content);
  }
  assert.strictEqual(importKey.mock.callCount(), 1);

  const broken = { signatures: [config({ privateKey: '-----BEGIN PRIVATE KEY-----\nnope\n' })] };
  assert.throws(() => new SmtpTransport({ host: 'localhost', dkim: broken }), {
    name: 'TypeError',
    message: /^Invalid DKIM private key for /,
  });
  // One that sends unsigned on a signing failure is left to do so.
  assert.doesNotThrow(
    () =>
      new SmtpTransport({
        host: 'localhost',
        dkim: { ...broken, onSigningFailure: 'send-unsigned' },
      }),
  );
});
