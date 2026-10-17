// Paths of the ported Mailtrap transport (src/mailtrap/) that upstream's suites
// leave out, against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { MailtrapTransport, createMailtrapConfig } = require('../../src/mailtrap/index.js');

const message = (extra = {}) =>
  createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Hello',
    content: { text: 'Hi' },
    ...extra,
  });
const config = { apiToken: 'token', retries: 0 };
const hang = (url, init) =>
  new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
const collect = async (iterable) => {
  const items = [];
  for await (const item of iterable) items.push(item);
  return items;
};

test('Mailtrap: a sandbox inbox id may be a string, but not a blank one', () => {
  assert.strictEqual(
    createMailtrapConfig({ apiToken: 't', sandbox: true, inboxId: '42' }).inboxId,
    '42',
  );
  assert.throws(
    () => createMailtrapConfig({ apiToken: 't', sandbox: true, inboxId: '  ' }),
    RangeError,
  );
});

test('Mailtrap: custom headers and inline attachments are sent', async (t) => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    request = { headers: new Headers(init.headers), body: JSON.parse(init.body) };
    return Response.json({ success: true, message_ids: ['mt-1'] });
  });
  const attachments = [
    {
      inline: true,
      filename: 'logo.png',
      content: new Uint8Array([1]),
      contentType: 'image/png',
      contentId: 'logo',
    },
  ];
  const transport = new MailtrapTransport({ ...config, headers: { 'X-Custom': 'yes' } });
  assert.strictEqual((await transport.send(message({ attachments }))).messageId, 'mt-1');
  assert.strictEqual(request.headers.get('x-custom'), 'yes');
  assert.deepStrictEqual(
    [request.body.attachments[0].disposition, request.body.attachments[0].content_id],
    ['inline', 'logo'],
  );
});

test('Mailtrap: unsuccessful and id-less responses fail the send', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, message_ids: [] }));
  const missing = await new MailtrapTransport(config).send(message());
  assert.deepStrictEqual(missing.errorMessages, ['Mailtrap response is missing a message ID.']);

  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ message: 'Bad sender' }, { status: 400 }),
  );
  assert.deepStrictEqual((await new MailtrapTransport(config).send(message())).errorMessages, [
    'Bad sender',
  ]);
});

test('Mailtrap: the timeout fails the send as a timeout', async (t) => {
  t.mock.method(globalThis, 'fetch', hang);
  const receipt = await new MailtrapTransport({ ...config, timeout: 20 }).send(message());
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.errors[0].category, 'timeout');
});

test('Mailtrap: a past Retry-After date is retried at once; an abort stops the wait', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () =>
    ++calls === 1
      ? new Response('', {
          status: 503,
          headers: { 'Retry-After': new Date(Date.now() - 1000).toUTCString() },
        })
      : Response.json({ success: true, message_ids: ['mt-2'] }),
  );
  const retried = await new MailtrapTransport({ ...config, retries: 1 }).send(message());
  assert.strictEqual(retried.messageId, 'mt-2');

  t.mock.restoreAll();
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('', { status: 503, headers: { 'Retry-After': '5' } }),
  );
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(
    new MailtrapTransport({ ...config, retries: 1 }).send(message(), { signal: controller.signal }),
    { name: 'AbortError' },
  );
});

test('Mailtrap: batches that fail, partly or whole, fail their messages', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ success: false, errors: ['Batch rejected'] }),
  );
  const rejected = await collect(new MailtrapTransport(config).sendMany([message(), message()]));
  assert.deepStrictEqual(
    rejected.map((receipt) => receipt.errorMessages),
    [['Batch rejected'], ['Batch rejected']],
  );

  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response('Oops', { status: 400 }));
  const failed = await collect(new MailtrapTransport(config).sendMany([message()]));
  assert.deepStrictEqual(failed[0].errorMessages, ['Oops']);

  // A message that cannot be converted fails alone; the rest of the batch goes.
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ success: true, responses: [{ success: true, message_ids: ['mt-3'] }] }),
  );
  const broken = () => {
    throw new Error('Cannot read attachment');
  };
  const attachments = [
    {
      inline: false,
      filename: 'a.bin',
      content: broken,
      contentType: 'application/octet-stream',
      contentId: '',
    },
  ];
  const mixed = await collect(
    new MailtrapTransport(config).sendMany([message({ attachments }), message()]),
  );
  assert.deepStrictEqual(
    mixed.map((receipt) => receipt.successful),
    [false, true],
  );
  assert.deepStrictEqual(await collect(new MailtrapTransport(config).sendMany([])), []);
  const allBroken = await collect(
    new MailtrapTransport(config).sendMany([message({ attachments })]),
  );
  assert.deepStrictEqual(allBroken[0].errorMessages, ['Cannot read attachment']);
});

test('Mailtrap: a 200 that is not JSON is sent once, of unknown delivery', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response('<html>accepted</html>', { status: 200 });
  });
  const receipt = await new MailtrapTransport({ ...config, retries: 3 }).send(message());
  assert.strictEqual(requests, 1);
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.deliveryUnknown, true);
  assert.strictEqual(receipt.retryable, false);
});
