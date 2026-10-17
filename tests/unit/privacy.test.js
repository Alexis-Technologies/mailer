// Addresses stay out of the error text that ./otel and ./logger export by
// default, such as an SMTP rejection naming its recipient.
const { test } = require('node:test');
const assert = require('node:assert');
const { redactAddresses } = require('../../src/internal/redact-addresses.js');

test('Privacy: every address in a text is redacted, and nothing else', () => {
  assert.strictEqual(
    redactAddresses('RCPT TO failed for bob@example.com: 550 5.1.1 <bob@example.com> unknown'),
    'RCPT TO failed for [REDACTED]: 550 5.1.1 <[REDACTED]> unknown',
  );
  assert.strictEqual(
    redactAddresses('a@b, "c d"@x.org; f@[192.0.2.1]'),
    '[REDACTED], [REDACTED]; [REDACTED]',
  );
  assert.strictEqual(redactAddresses('user@пример.рф'), '[REDACTED]');
  for (const text of ['Connection timeout', 'a lone @ sign', 'trailing@', '@leading', '']) {
    assert.strictEqual(redactAddresses(text), text);
  }
});

test('Privacy: redaction runs in linear time on a long text without an address', () => {
  const long = `${'a'.repeat(200_000)}@`;
  const started = performance.now();
  assert.strictEqual(redactAddresses(long), long);
  assert.strictEqual(redactAddresses('a@'.repeat(100_000)), '[REDACTED]');
  assert.strictEqual(redactAddresses('"@['.repeat(100_000)).length, 300_000);
  assert.ok(performance.now() - started < 1000);
});
