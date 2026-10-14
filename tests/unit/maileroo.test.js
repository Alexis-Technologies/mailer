// Paths of the ported Maileroo transport (src/maileroo/) that upstream's
// suites leave out, against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { MailerooTransport } = require('../../src/maileroo/index.js');

const message = () =>
  createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Hello',
    content: { text: 'Hi' },
  });
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
