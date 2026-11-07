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

test('Privacy: a phone number in E.164 is redacted with the addresses, and nothing else', () => {
  const { redactRecipients } = require('../../src/internal/redact-addresses.js');
  const cases = [
    ["The 'To' number +380671234567 is not valid.", "The 'To' number [REDACTED] is not valid."],
    ['Call +38 (067) 123-45-67 or +44 20 7946 0018.', 'Call [REDACTED] or [REDACTED].'],
    ['bob@example.com and +14155552671', '[REDACTED] and [REDACTED]'],
    ['++380671234567', '+[REDACTED]'],
  ];
  for (const [text, redacted] of cases) assert.strictEqual(redactRecipients(text), redacted, text);
  // Too short, too long, inside a word, or without its plus: not a number in E.164.
  for (const text of [
    'version +1, score +123456',
    '+1234567890123456',
    'id a+380671234567',
    'chat 380671234567',
    'a + b',
    '',
  ]) {
    assert.strictEqual(redactRecipients(text), text);
  }
  const started = performance.now();
  assert.strictEqual(redactRecipients('+1 '.repeat(100_000)).length, 300_000);
  assert.strictEqual(redactRecipients('+'.repeat(300_000)).length, 300_000);
  assert.ok(performance.now() - started < 1000);
});

test('Privacy: the reasons of the queue, the warnings and the retries name no phone', async (t) => {
  // Before: only email addresses were redacted, so a refusal of an SMS
  // provider wrote its number into the store of the queue and the logs.
  const { auditErrorOf, reasonOf } = require('../../src/queue/outcome.js');
  const { describeThrown } = require('../../src/internal/callback.js');
  const { requestWithRetry } = require('../../src/internal/http.js');
  assert.strictEqual(describeThrown(new Error('+380671234567 opted out')), '[REDACTED] opted out');
  assert.strictEqual(
    reasonOf('Twilio: +380671234567 is unreachable'),
    'Twilio: [REDACTED] is unreachable',
  );
  const audited = auditErrorOf({
    successful: false,
    errorMessages: ['The number +380671234567 is unreachable'],
    errors: [{ category: 'unreachable', code: '30003', retryable: true, message: 'x' }],
    retryable: true,
  });
  assert.strictEqual(audited.message, 'The number [REDACTED] is unreachable');
  const records = [];
  const log = { write: (level, fields, message) => records.push([message, fields()]) };
  let attempts = 0;
  await requestWithRetry({
    log,
    retries: 1,
    timeoutMs: 0,
    sleep: async () => {},
    isIdempotent: true,
    send: async () => {
      if (attempts++ === 0) {
        throw Object.assign(new Error('refused for +380671234567'), { statusCode: 503 });
      }
      return new Response('{}');
    },
    read: async () => undefined,
    reject: async () => undefined,
  });
  assert.strictEqual(records[0][1].error, 'refused for [REDACTED]');
});
