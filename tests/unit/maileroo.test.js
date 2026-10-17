// Paths of the ported Maileroo transport (src/maileroo/) that upstream's
// suites leave out, against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { MailerooTransport } = require('../../src/maileroo/index.js');

const base = {
  from: 'alex@example.com',
  to: 'bob@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
};
const message = () => createMessage(base);
const config = { apiKey: 'key', retries: 0 };

test('Maileroo: an error body gives its message, its error or its errors', async (t) => {
  const cases = [
    [{ error: 'Sender not verified' }, 'Sender not verified'],
    [{ errors: [{ field: 'to' }] }, '[{"field":"to"}]'],
  ];
  for (const [body, expected] of cases) {
    t.mock.restoreAll();
    t.mock.method(globalThis, 'fetch', async () => Response.json(body, { status: 422 }));
    const receipt = await new MailerooTransport(config).send(message());
    assert.deepStrictEqual(receipt.errorMessages, [expected]);
  }
});

test('Maileroo: an unsuccessful 200 without a message fails the send', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: false }));
  const receipt = await new MailerooTransport(config).send(message());
  assert.deepStrictEqual(receipt.errorMessages, ['Maileroo reported an unsuccessful response.']);
});

test('Maileroo: the reference of an idempotency key hashes its UTF-8 bytes', async () => {
  const { convertMessage } = require('../../src/maileroo/message-converter.js');
  const referenceOf = async (idempotencyKey) => {
    const converted = await convertMessage(createMessage({ ...base, idempotencyKey }), {});
    return converted.reference_id;
  };
  // Values of upstream's three FNV-1a hashes, which a Maileroo reference keeps.
  assert.strictEqual(await referenceOf('welcome-message-1'), '55232a4fbce60dabbd33e909');
  assert.strictEqual(await referenceOf('Ключ 🔑'), '5ff86cd948e80925429c97c7');
});
