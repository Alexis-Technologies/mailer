// Paths of the ported SES transport (src/ses/) that upstream reaches only
// through its e2e suite: session credentials, HTTP and network failures,
// timeouts, aborts and attachment defaults, all against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { SesTransport } = require('../../src/ses/index.js');

const message = (extra = {}) =>
  createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Hello',
    content: { text: 'Hi' },
    ...extra,
  });
const authentication = { type: 'credentials', accessKeyId: 'AKID', secretAccessKey: 'secret' };

const withFetch = async (t, handler) => {
  t.mock.method(globalThis, 'fetch', handler);
};

test('SES: session credentials and custom headers are signed', async (t) => {
  let request;
  await withFetch(t, async (url, init) => {
    request = new Headers(init.headers);
    return new Response('{"MessageId":"m1"}', { status: 200 });
  });
  const transport = new SesTransport({
    authentication: { type: 'session', accessKeyId: 'A', secretAccessKey: 'S', sessionToken: 'T' },
    headers: { 'X-Custom': 'yes' },
    retries: 0,
  });
  assert.deepStrictEqual(await transport.send(message()), {
    successful: true,
    messageId: 'm1',
    provider: 'ses',
  });
  assert.strictEqual(request.get('x-amz-security-token'), 'T');
  assert.strictEqual(request.get('x-custom'), 'yes');
  assert.match(request.get('authorization'), /SignedHeaders=host;x-amz-date;x-amz-security-token/);
});

test('SES: an unknown authentication type fails the send', async () => {
  const transport = new SesTransport({ authentication: { type: 'role' }, retries: 0 });
  const receipt = await transport.send(message());
  assert.strictEqual(receipt.successful, false);
  assert.deepStrictEqual(receipt.errorMessages, ['Unsupported authentication type: role']);
});

test('SES: HTTP and network failures become failed receipts', async (t) => {
  const cases = [
    [() => new Response('Internal oops', { status: 500 }), 'Internal oops', 'server-error'],
    [() => new Response('', { status: 500 }), 'HTTP 500', 'server-error'],
    [
      () => {
        throw new TypeError('fetch failed');
      },
      'fetch failed',
      'network',
    ],
  ];
  for (const [respond, expected, category] of cases) {
    t.mock.restoreAll();
    await withFetch(t, async () => respond());
    const receipt = await new SesTransport({ authentication, retries: 0 }).send(message());
    assert.deepStrictEqual(receipt.errorMessages, [expected]);
    assert.strictEqual(receipt.errors[0].category, category);
  }
});

test('SES: a request over the timeout fails, and an abort between retries rejects', async (t) => {
  await withFetch(
    t,
    (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      }),
  );
  const slow = await new SesTransport({ authentication, retries: 0, timeout: 20 }).send(message());
  assert.deepStrictEqual(slow.errorMessages, ['SES API request timed out after 20 ms.']);

  t.mock.restoreAll();
  await withFetch(t, async () => new Response('', { status: 500 }));
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(
    new SesTransport({ authentication, retries: 1 }).send(message(), {
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );
});

test('SES: a 200 without JSON gets a generated message id', async (t) => {
  await withFetch(t, async () => new Response('not json', { status: 200 }));
  const receipt = await new SesTransport({ authentication, retries: 0 }).send(message());
  assert.strictEqual(receipt.successful, true);
  assert.match(receipt.messageId, /^ses-\d+-\w+$/);
});

test('SES: an inline attachment without a type is sent as INLINE octet-stream', async (t) => {
  let body;
  await withFetch(t, async (url, init) => {
    body = JSON.parse(init.body);
    return new Response('{"MessageId":"m"}');
  });
  const attachments = [
    {
      inline: true,
      filename: 'a.png',
      content: new Uint8Array([1]),
      contentType: '',
      contentId: 'logo',
    },
  ];
  await new SesTransport({ authentication, retries: 0 }).send(message({ attachments }));
  assert.deepStrictEqual(body.Content.Simple.Attachments, [
    {
      FileName: 'a.png',
      ContentType: 'application/octet-stream',
      ContentDisposition: 'INLINE',
      ContentTransferEncoding: 'BASE64',
      RawContent: 'AQ==',
      ContentId: 'logo',
    },
  ]);
});

test('SES: sendMany reads an async iterable', async (t) => {
  let calls = 0;
  await withFetch(t, async () => new Response(`{"MessageId":"m${++calls}"}`));
  const messages = async function* () {
    yield message();
    yield message();
  };
  const receipts = [];
  for await (const receipt of new SesTransport({ authentication, retries: 0 }).sendMany(
    messages(),
  )) {
    receipts.push(receipt.messageId);
  }
  assert.deepStrictEqual(receipts.sort(), ['m1', 'm2']);
});
