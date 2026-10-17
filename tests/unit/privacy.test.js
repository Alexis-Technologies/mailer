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

test('Privacy: the warning of a hook that threw names no address', async (t) => {
  // Before: the message of what a hook, a listener or a store threw went into
  // the process warning as it was.
  const { createMessage } = require('../../index.js');
  const { HooksTransport } = require('../../src/hooks/index.js');
  const { fakeTransport } = require('../helpers/decorators/fake.js');
  const warnings = [];
  t.mock.method(process, 'emitWarning', (text) => warnings.push(text));
  const hooks = new HooksTransport(fakeTransport(), {
    afterSend: () => {
      throw new Error('cannot record the delivery to carol@example.com');
    },
  });
  await hooks.send(
    createMessage({
      from: 'a@example.com',
      to: 'carol@example.com',
      subject: 's',
      content: { text: 'x' },
    }),
  );
  assert.strictEqual(warnings.length, 1);
  assert.ok(!warnings[0].includes('carol@example.com'), warnings[0]);
  assert.match(warnings[0], /cannot record the delivery to/);
});
