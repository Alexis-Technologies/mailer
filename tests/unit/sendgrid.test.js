// Paths of the ported SendGrid transport (src/sendgrid/) that upstream reaches
// only through its e2e suite, against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { SendGridTransport } = require('../../src/sendgrid/index.js');

const message = (extra = {}) =>
  createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Hello',
    content: { text: 'Hi' },
    ...extra,
  });
const accepted = (headers = {}) => new Response('', { status: 202, headers });
const hang = (url, init) =>
  new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });

test('SendGrid: a 202 is a success, with the X-Message-Id or a generated id', async (t) => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    request = { headers: new Headers(init.headers), body: JSON.parse(init.body) };
    return accepted({ 'X-Message-Id': 'sg-1' });
  });
  const transport = new SendGridTransport({ apiKey: 'key', headers: { 'X-Custom': 'yes' } });
  assert.deepStrictEqual(await transport.send(message({ priority: 'low' })), {
    successful: true,
    messageId: 'sg-1',
    provider: 'sendgrid',
  });
  assert.strictEqual(request.headers.get('x-custom'), 'yes');
  assert.deepStrictEqual(
    {
      priority: request.body.headers['X-Priority'],
      importance: request.body.headers.Importance,
    },
    { priority: '5', importance: 'Low' },
  );

  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => accepted());
  const generated = await transport.send(message());
  assert.match(
    generated.messageId,
    /^sendgrid-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
});

test('SendGrid: sendMany sends arrays and async iterables one by one', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => accepted({ 'X-Message-Id': `m${++calls}` }));
  const transport = new SendGridTransport({ apiKey: 'key' });
  const ids = [];
  for await (const receipt of transport.sendMany([message(), message()])) {
    ids.push(receipt.messageId);
  }
  const iterable = async function* () {
    yield message();
  };
  for await (const receipt of transport.sendMany(iterable())) ids.push(receipt.messageId);
  assert.deepStrictEqual(ids, ['m1', 'm2', 'm3']);
});

test('SendGrid: error bodies, retries, timeouts and aborts', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Oops', { status: 400 }));
  const transport = new SendGridTransport({ apiKey: 'key', retries: 0 });
  assert.deepStrictEqual((await transport.send(message())).errorMessages, ['Oops']);

  t.mock.restoreAll();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('', { status: 503 });
  });
  const retried = await new SendGridTransport({ apiKey: 'key', retries: 1 }).send(message());
  assert.strictEqual(calls, 2);
  assert.deepStrictEqual(retried.errorMessages, ['HTTP 503']);

  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', hang);
  const slow = await new SendGridTransport({ apiKey: 'key', retries: 0, timeout: 20 }).send(
    message(),
  );
  assert.deepStrictEqual(slow.errorMessages, ['SendGrid API request timed out after 20 ms.']);

  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(
    new SendGridTransport({ apiKey: 'key', retries: 1 }).send(message(), {
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );
});

test('SendGrid: sendMany sends `concurrency` messages at once and keeps their order', async (t) => {
  let inFlight = 0;
  let most = 0;
  let index = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    const id = `m${index++}`;
    inFlight++;
    most = Math.max(most, inFlight);
    // Each answer comes sooner than the one before it.
    await new Promise((resolve) => setTimeout(resolve, 20 - index * 4));
    inFlight--;
    return new Response(null, { status: 202, headers: { 'x-message-id': id } });
  });
  const transport = new SendGridTransport({ apiKey: 'SG.key', retries: 0, concurrency: 3 });
  const messages = [];
  for (let i = 0; i < 4; i++) {
    messages.push(
      createMessage({ from: 'a@example.com', to: 'b@example.com', subject: `${i}`, content: {} }),
    );
  }
  const ids = [];
  for await (const receipt of transport.sendMany(messages)) ids.push(receipt.messageId);
  assert.deepStrictEqual(ids, ['m0', 'm1', 'm2', 'm3']);
  assert.strictEqual(most, 3);
  assert.throws(() => new SendGridTransport({ apiKey: 'SG.key', concurrency: 0 }), RangeError);
});
