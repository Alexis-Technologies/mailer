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
const { signMessage } = require('../../src/mime/dkim/sign.js');

const config = (extra) => ({
  signingDomain: TEST_DKIM_DOMAIN,
  selector: TEST_DKIM_SELECTOR,
  privateKey: TEST_DKIM_PRIVATE_KEY,
  ...extra,
});

// Whether an RSA signature with relaxed header canonicalization covers exactly
// `signed`, the relaxed form of the fields in h= order.
const verifies = (result, signed) => {
  const signature = /(?:^|;\s*)b=([^;]+)$/.exec(result.signature)[1];
  const unsigned = result.signature.slice(0, -signature.length);
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
  // The third x-tag and the second subject have no instance left: they add nothing.
  assert.strictEqual(
    verifies(result, ['from:alex@example.com', 'x-tag:two', 'x-tag:one', 'subject:Hello']),
    true,
  );
});
