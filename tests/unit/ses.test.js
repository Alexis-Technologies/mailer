// Paths of the ported SES transport (src/ses/) that upstream reaches only
// through its e2e suite: session credentials, HTTP and network failures,
// timeouts, aborts and attachment defaults, all against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { SesTransport } = require('../../src/ses/index.js');
const { SesHttpClient } = require('../../src/ses/http-client.js');
const PostalMime = require('postal-mime');
const { createSesConfig } = require('../../src/ses/config.js');
const { convertMessage } = require('../../src/ses/message-converter.js');

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

test('SES: a wrong authentication is refused when the transport is made', () => {
  const wrong = [
    { type: 'role' },
    { type: 'credentials', accessKeyId: 'AKID' },
    { type: 'session', accessKeyId: 'AKID', secretAccessKey: 'secret' },
    undefined,
  ];
  for (const candidate of wrong) {
    assert.throws(() => new SesTransport({ authentication: candidate }), TypeError);
  }
  assert.throws(() => new SesTransport({ authentication: { type: 'role' } }), {
    message: 'Unsupported authentication type: role',
  });
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
  assert.match(
    receipt.messageId,
    /^ses-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
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

test('SES: a display name with "<", "," or "@" stays a single mailbox', async () => {
  const name = 'x\\", eve@evil.example, "';
  const converted = await convertMessage(
    createMessage({
      from: { name: 'Support <attacker@evil.com>, Real', address: 'alex@example.com' },
      to: { name, address: 'bob@example.com' },
      subject: 'Hello',
      content: { text: 'Hi' },
    }),
    createSesConfig({}),
  );
  const parsed = await PostalMime.parse(
    `From: ${converted.FromEmailAddress}\r\nTo: ${converted.Destination.ToAddresses[0]}\r\n\r\n`,
  );
  assert.deepStrictEqual(parsed.from, {
    address: 'alex@example.com',
    name: 'Support <attacker@evil.com>, Real',
  });
  assert.deepStrictEqual(parsed.to, [{ address: 'bob@example.com', name }]);
});

test('SES: a request is signed as the SigV4 test suite of AWS expects', (t) => {
  // "get-vanilla" of the AWS Signature Version 4 test suite.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2015-08-30T12:36:00Z') });
  const client = new SesHttpClient(createSesConfig({ region: 'us-east-1' }));
  const credentials = {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  };
  for (let call = 0; call < 2; call++) {
    const headers = client.signRequest(
      'https://example.amazonaws.com/',
      { method: 'GET' },
      credentials,
      'service',
    );
    assert.strictEqual(headers.get('X-Amz-Date'), '20150830T123600Z');
    assert.strictEqual(
      headers.get('Authorization'),
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
        'SignedHeaders=host;x-amz-date, ' +
        'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  }
});

test('SES: a rate limit (429) is retried, a refusal (400) is not', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response('{"message":"x"}', { status: requests === 1 ? 429 : 400 });
  });
  const receipt = await new SesTransport({ authentication, retries: 3 }).send(message());
  assert.strictEqual(requests, 2);
  assert.strictEqual(receipt.errors[0].statusCode, 400);
});

// A generator of many messages that counts how many were read.
const counted = (count, make) => {
  const state = { read: 0 };
  state.messages = (function* () {
    for (let index = 0; index < count; index++) {
      state.read++;
      yield make(index);
    }
  })();
  return state;
};

test('SES: sendMany reads a batch at a time, not its whole input first', async (t) => {
  await withFetch(t, async () => new Response('{"MessageId":"m1"}', { status: 200 }));
  const transport = new SesTransport({ authentication, retries: 0, batchSize: 2 });
  const input = counted(1000, () => message());
  for await (const receipt of transport.sendMany(input.messages)) {
    assert.strictEqual(receipt.successful, true);
    break;
  }
  assert.strictEqual(input.read, 2);
});

test('SES: custom and threading header fields go in Headers, those SES sets left out', async () => {
  const config = createSesConfig({ authentication });
  const converted = await convertMessage(
    message({
      headers: {
        'X-Campaign': 'spring',
        'X-Label': 'Café crème',
        'Return-Path': 'bounce@example.com',
        'X-Empty': '',
      },
      inReplyTo: '<parent@example.com>',
    }),
    config,
  );
  assert.deepStrictEqual(converted.Content.Simple.Headers, [
    { Name: 'x-campaign', Value: 'spring' },
    { Name: 'x-label', Value: `=?UTF-8?B?${Buffer.from('Café crème').toString('base64')}?=` },
    { Name: 'In-Reply-To', Value: '<parent@example.com>' },
  ]);
  const plain = await convertMessage(message(), config);
  assert.strictEqual(plain.Content.Simple.Headers, undefined);
});

test('SES: more header fields than SES takes fail the send before any request', async (t) => {
  let requests = 0;
  await withFetch(t, async () => {
    requests++;
    return new Response('{"MessageId":"m1"}', { status: 200 });
  });
  const headers = {};
  for (let index = 0; index < 16; index++) headers[`X-Field-${index}`] = 'value';
  const transport = new SesTransport({ authentication, retries: 0 });
  const receipt = await transport.send(message({ headers }));
  assert.strictEqual(receipt.successful, false);
  assert.match(receipt.errorMessages[0], /at most 15 custom header fields/);
  assert.strictEqual(requests, 0);
});
