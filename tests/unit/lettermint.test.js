// Paths of the ported Lettermint transport (src/lettermint/) that upstream's
// suites leave out, against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { LettermintTransport } = require('../../src/lettermint/index.js');

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

test('Lettermint: custom headers are sent, and a 200 without JSON fails', async (t) => {
  let headers;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    headers = new Headers(init.headers);
    return new Response('<html>', { status: 200 });
  });
  const receipt = await new LettermintTransport({
    ...config,
    headers: { 'X-Custom': 'yes' },
  }).send(message());
  assert.strictEqual(headers.get('x-custom'), 'yes');
  assert.match(receipt.errorMessages[0], /^Invalid JSON response from Lettermint API: /);
});

test('Lettermint: an error body gives its error or its errors', async (t) => {
  const cases = [
    [{ error: 'Route not found' }, 'Route not found'],
    [{ errors: { to: ['invalid'] } }, null],
    [{ errors: [{ field: 'to' }] }, '[{"field":"to"}]'],
  ];
  for (const [body, expected] of cases) {
    t.mock.restoreAll();
    t.mock.method(globalThis, 'fetch', async () => Response.json(body, { status: 422 }));
    const receipt = await new LettermintTransport(config).send(message());
    assert.strictEqual(receipt.successful, false);
    if (expected !== null) assert.deepStrictEqual(receipt.errorMessages, [expected]);
  }
});

test('Lettermint: the timeout fails the send, and an abort stops a retry', async (t) => {
  t.mock.method(globalThis, 'fetch', hang);
  const slow = await new LettermintTransport({ ...config, timeout: 20 }).send(message());
  assert.strictEqual(slow.errors[0].category, 'timeout');

  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(
    new LettermintTransport({ ...config, retries: 1 }).send(message(), {
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );
});

test('Lettermint: a batch whose every message fails to convert sends nothing', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json([]);
  });
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
  const receipts = [];
  for await (const receipt of new LettermintTransport(config).sendMany([
    message({ attachments }),
  ])) {
    receipts.push(receipt);
  }
  assert.strictEqual(calls, 0);
  assert.deepStrictEqual(receipts[0].errorMessages, ['Cannot read attachment']);
});
