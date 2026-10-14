// Paths of the ported Resend transport (src/resend/) that upstream reaches
// only through its e2e suite, against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { ResendTransport } = require('../../src/resend/index.js');

const message = (index = 0) =>
  createMessage({
    from: 'Alex "the Sender" <alex@example.com>',
    to: `bob${index}@example.com`,
    subject: 'Hello',
    content: { text: 'Hi' },
  });
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('Resend: custom headers are sent and a quoted name is escaped', async (t) => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    request = { headers: new Headers(init.headers), body: JSON.parse(init.body) };
    return json({ id: 'r1' });
  });
  const transport = new ResendTransport({ apiKey: 'key', headers: { 'X-Custom': 'yes' } });
  const receipt = await transport.send(message());
  assert.strictEqual(receipt.messageId, 'r1');
  assert.strictEqual(request.headers.get('x-custom'), 'yes');
  assert.strictEqual(request.body.from, '"Alex \\"the Sender\\"" <alex@example.com>');
});

test('Resend: a 200 that is not JSON, and a request over the timeout, fail', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>', { status: 200 }));
  const broken = await new ResendTransport({ apiKey: 'key', retries: 0 }).send(message());
  assert.strictEqual(broken.successful, false);
  assert.match(broken.errorMessages[0], /^Invalid JSON response from Resend API: /);

  t.mock.restoreAll();
  t.mock.method(
    globalThis,
    'fetch',
    (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      }),
  );
  const slow = await new ResendTransport({ apiKey: 'key', retries: 0, timeout: 20 }).send(
    message(),
  );
  assert.deepStrictEqual(slow.errorMessages, ['Resend API request timed out after 20 ms.']);
});

test('Resend: more than 100 messages go out in batches of 100', async (t) => {
  const batches = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const body = JSON.parse(init.body);
    batches.push(body.length);
    return json({ data: body.map((_, index) => ({ id: `b${batches.length}-${index}` })) });
  });
  const messages = async function* () {
    for (let index = 0; index < 150; index++) yield message(index);
  };
  const receipts = [];
  for await (const receipt of new ResendTransport({ apiKey: 'key' }).sendMany(messages())) {
    receipts.push(receipt);
  }
  assert.deepStrictEqual(batches, [100, 50]);
  assert.strictEqual(receipts.length, 150);
  assert.ok(receipts.every((receipt) => receipt.successful));
});

test('Resend: a failed batch fails each of its messages', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({ message: 'Bad batch' }, 422));
  const receipts = [];
  const transport = new ResendTransport({ apiKey: 'key', retries: 0 });
  for await (const receipt of transport.sendMany([message(1), message(2)])) {
    receipts.push(receipt);
  }
  assert.deepStrictEqual(
    receipts.map((receipt) => receipt.errorMessages),
    [['Bad batch'], ['Bad batch']],
  );
});
