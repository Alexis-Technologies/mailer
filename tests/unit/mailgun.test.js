// Paths of the ported Mailgun transport (src/mailgun/) that upstream's suites
// leave out, against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { MailgunTransport } = require('../../src/mailgun/index.js');
const PostalMime = require('postal-mime');
const { convertMessage } = require('../../src/mailgun/message-converter.js');

const message = () =>
  createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Hello',
    content: { text: 'Hi' },
  });
const config = { apiKey: 'key', domain: 'mg.example.com' };

test('Mailgun: an unknown region is refused', () => {
  assert.throws(() => new MailgunTransport({ ...config, region: 'ap' }), {
    message: 'Unsupported region: ap',
  });
});

test('Mailgun: custom headers are sent, and a 2xx without JSON fails', async (t) => {
  let headers;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    headers = new Headers(init.headers);
    return new Response('queued', { status: 200 });
  });
  const transport = new MailgunTransport({ ...config, headers: { 'X-Custom': 'yes' }, retries: 0 });
  const receipt = await transport.send(message());
  assert.strictEqual(headers.get('x-custom'), 'yes');
  assert.strictEqual(receipt.successful, false);
  assert.match(
    receipt.errorMessages[0],
    /^Successfully received response but failed to parse JSON/,
  );
});

test('Mailgun: sendMany reads an async iterable', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ id: `<m${++calls}@mg.example.com>`, message: 'Queued. Thank you.' }),
  );
  const messages = async function* () {
    yield message();
    yield message();
  };
  const ids = [];
  for await (const receipt of new MailgunTransport(config).sendMany(messages())) {
    ids.push(receipt.messageId);
  }
  assert.strictEqual(ids.length, 2);
  assert.ok(ids.every((id) => /^<?m\d@mg\.example\.com>?$/.test(id)));
});

test('Mailgun: a display name with "<", "," or "@" stays a single mailbox', async () => {
  const name = 'x\\", eve@evil.example, "';
  const converted = await convertMessage(
    createMessage({
      from: { name: 'Support <attacker@evil.com>, Real', address: 'alex@example.com' },
      to: { name, address: 'bob@example.com' },
      subject: 'Hello',
      content: { text: 'Hi' },
    }),
    config,
  );
  const parsed = await PostalMime.parse(
    `From: ${converted.get('from')}\r\nTo: ${converted.get('to')}\r\n\r\n`,
  );
  assert.deepStrictEqual(parsed.from, {
    address: 'alex@example.com',
    name: 'Support <attacker@evil.com>, Real',
  });
  assert.deepStrictEqual(parsed.to, [{ address: 'bob@example.com', name }]);
});

test('Mailgun: an inline part goes under its Content-ID, which cid: refers to', async () => {
  const withLogo = createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Logo',
    content: { html: '<img src="cid:logo@example.com">' },
    attachments: [
      {
        inline: true,
        filename: 'logo.png',
        content: new Uint8Array([1, 2, 3]),
        contentType: 'image/png',
        contentId: 'logo@example.com',
      },
    ],
  });
  const form = await convertMessage(withLogo, { domain: 'mg.example.com' });
  const inline = form.getAll('inline');
  assert.strictEqual(inline.length, 1);
  assert.strictEqual(inline[0].name, 'logo@example.com');
});
