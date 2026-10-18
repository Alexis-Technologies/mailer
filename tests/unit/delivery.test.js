// A provider that answered 2xx took the request: whatever fails after that,
// such as reading the body, must not send the message again.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMessage } = require('../../index.js');
const { LettermintTransport } = require('../../src/lettermint/index.js');
const { MailerooTransport } = require('../../src/maileroo/index.js');
const { MailgunTransport } = require('../../src/mailgun/index.js');
const { MailtrapTransport } = require('../../src/mailtrap/index.js');
const { PlunkTransport } = require('../../src/plunk/index.js');
const { ResendTransport } = require('../../src/resend/index.js');
const { SendGridTransport } = require('../../src/sendgrid/index.js');
const { SesTransport } = require('../../src/ses/index.js');
const { JmapTransport } = require('../../src/jmap/index.js');
const { AzureTransport } = require('../../src/azure/index.js');
const { BrevoTransport } = require('../../src/brevo/index.js');
const { CloudflareTransport } = require('../../src/cloudflare/index.js');
const { MailerSendTransport } = require('../../src/mailersend/index.js');
const { MailjetTransport } = require('../../src/mailjet/index.js');
const { PostmarkTransport } = require('../../src/postmark/index.js');
const { ScalewayTransport } = require('../../src/scaleway/index.js');
const { Smtp2goTransport } = require('../../src/smtp2go/index.js');
const { SparkPostTransport } = require('../../src/sparkpost/index.js');
const { ZeptoMailTransport } = require('../../src/zeptomail/index.js');

const message = () =>
  createMessage({
    from: 'alex@example.com',
    to: 'bob@example.com',
    subject: 'Hello',
    content: { text: 'Hi' },
  });

// One retry: a provider that resends shows two requests, as Resend, Lettermint, Brevo and
// Azure do with the idempotency key they always send.
const options = { retries: 1 };
const WITH_KEYS = new Set(['Resend', 'Lettermint', 'Brevo', 'Azure']);
const expectedRequests = (name) => (WITH_KEYS.has(name) ? 2 : 1);
const AZURE_KEY = Buffer.from('azure-access-key').toString('base64');
const providers = [
  [
    'SES',
    200,
    (extra) =>
      new SesTransport({
        ...options,
        ...extra,
        authentication: { type: 'credentials', accessKeyId: 'a', secretAccessKey: 'b' },
      }),
  ],
  ['Resend', 200, (extra) => new ResendTransport({ ...options, ...extra, apiKey: 'key' })],
  ['SendGrid', 202, (extra) => new SendGridTransport({ ...options, ...extra, apiKey: 'key' })],
  [
    'Mailgun',
    200,
    (extra) =>
      new MailgunTransport({ ...options, ...extra, apiKey: 'key', domain: 'mg.example.com' }),
  ],
  ['Mailtrap', 200, (extra) => new MailtrapTransport({ ...options, ...extra, apiToken: 'token' })],
  ['Maileroo', 200, (extra) => new MailerooTransport({ ...options, ...extra, apiKey: 'key' })],
  [
    'Lettermint',
    200,
    (extra) => new LettermintTransport({ ...options, ...extra, apiToken: 'token' }),
  ],
  ['Plunk', 200, (extra) => new PlunkTransport({ ...options, ...extra, apiKey: 'key' })],
];
// The providers of 1.1, on the shared client of src/internal/api.js: the same
// contracts, every one of them.
const providersOf11 = [
  [
    'Postmark',
    200,
    (extra) => new PostmarkTransport({ ...options, ...extra, serverToken: 'token' }),
  ],
  ['Brevo', 201, (extra) => new BrevoTransport({ ...options, ...extra, apiKey: 'key' })],
  [
    'Mailjet',
    200,
    (extra) => new MailjetTransport({ ...options, ...extra, apiKey: 'a', apiSecret: 'b' }),
  ],
  ['MailerSend', 202, (extra) => new MailerSendTransport({ ...options, ...extra, apiKey: 'key' })],
  ['SparkPost', 200, (extra) => new SparkPostTransport({ ...options, ...extra, apiKey: 'key' })],
  ['ZeptoMail', 201, (extra) => new ZeptoMailTransport({ ...options, ...extra, token: 'token' })],
  ['SMTP2GO', 200, (extra) => new Smtp2goTransport({ ...options, ...extra, apiKey: 'key' })],
  [
    'Azure',
    202,
    (extra) =>
      new AzureTransport({
        ...options,
        ...extra,
        connectionString: `endpoint=https://contoso.communication.azure.com/;accesskey=${AZURE_KEY}`,
      }),
  ],
  [
    'Scaleway',
    200,
    (extra) =>
      new ScalewayTransport({
        ...options,
        ...extra,
        secretKey: 'key',
        projectId: '11111111-2222-4333-8444-555555555555',
      }),
  ],
  [
    'Cloudflare',
    200,
    (extra) =>
      new CloudflareTransport({
        ...options,
        ...extra,
        accountId: '023e105f4ecef8ad9ca31a8372d0c353',
        apiToken: 'token',
      }),
  ],
];
// The clients ported from upyo, which expose sendMessage of their own.
const portedProviders = providers.slice();
for (const provider of providersOf11) providers.push(provider);

// A 2xx whose body cannot be read: the connection broke after the headers.
const unreadable = (status) =>
  new Response(
    new ReadableStream({
      pull(controller) {
        controller.error(new Error('Connection reset while reading the body.'));
      },
    }),
    { status },
  );

test('Delivery: a 2xx with an unreadable body is sent once, of unknown delivery', async (t) => {
  for (const [name, status, create] of providers) {
    let requests = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      requests++;
      return unreadable(status);
    });
    const receipt = await create().send(message());
    t.mock.restoreAll();
    assert.strictEqual(requests, expectedRequests(name), name);
    assert.strictEqual(receipt.successful, false, name);
    assert.strictEqual(receipt.deliveryUnknown, true, name);
    assert.strictEqual(receipt.retryable, false, name);
  }
});

test('Delivery: Plunk refusing in a 200 is sent once, a definite failure', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return Response.json({ success: false, message: 'Sender not verified' });
  });
  const receipt = await new PlunkTransport({ ...options, apiKey: 'key' }).send(message());
  assert.strictEqual(requests, 1);
  assert.strictEqual(receipt.successful, false);
  assert.strictEqual(receipt.deliveryUnknown, undefined);
  assert.strictEqual(receipt.retryable, false);
  assert.match(receipt.errorMessages[0], /Sender not verified/);
});

// A 2xx whose body never ends, until the signal of the request aborts, as
// fetch errors the body of an aborted request.
const stalled = (status, signal) =>
  new Response(
    new ReadableStream({
      start(controller) {
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
    }),
    { status },
  );

test(
  'Delivery: the timeout covers a body that never ends, of unknown delivery',
  { timeout: 5000 },
  async (t) => {
    for (const [name, status, create] of providers) {
      t.mock.method(globalThis, 'fetch', async (_url, init) => stalled(status, init.signal));
      const transport = create({ timeout: 20 });
      const started = performance.now();
      const receipt = await transport.send(message());
      t.mock.restoreAll();
      // Resend and Lettermint retry once with their key, after up to a second.
      assert.ok(performance.now() - started < 3000, name);
      assert.strictEqual(receipt.successful, false, name);
      assert.strictEqual(receipt.deliveryUnknown, true, name);
    }
  },
);

test('Delivery: a timeout of 0 or Infinity sets none, a bad one is refused', async (t) => {
  for (const [name, , create] of providers) {
    for (const timeout of [0, Infinity]) {
      t.mock.method(globalThis, 'fetch', async (_url, init) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify({ aborted: init.signal.aborted }), { status: 400 });
      });
      const receipt = await create({ timeout, retries: 0 }).send(message());
      t.mock.restoreAll();
      assert.strictEqual(receipt.errors[0].statusCode, 400, `${name} ${timeout}`);
    }
    assert.throws(() => create({ timeout: -1 }), RangeError, name);
    assert.throws(() => create({ retries: 1.5 }), RangeError, name);
  }
});

test(
  'Delivery: a Retry-After of two minutes is not waited for but returned',
  { timeout: 5000 },
  async (t) => {
    for (const [name, , create] of providers) {
      let requests = 0;
      t.mock.method(globalThis, 'fetch', async () => {
        requests++;
        return new Response('busy', { status: 503, headers: { 'Retry-After': '120' } });
      });
      const receipt = await create().send(message());
      t.mock.restoreAll();
      assert.strictEqual(requests, 1, name);
      assert.strictEqual(receipt.errors[0].retryAfterMilliseconds, 120_000, name);
    }
  },
);

test('Delivery: a redirect is not followed, nor retried', async (t) => {
  for (const [name, , create] of providers) {
    const redirects = [];
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      redirects.push(init.redirect);
      return new Response(null, { status: 307, headers: { Location: 'https://evil.example/' } });
    });
    const receipt = await create().send(message());
    t.mock.restoreAll();
    assert.deepStrictEqual(redirects, ['manual'], name);
    assert.strictEqual(receipt.successful, false, name);
    assert.strictEqual(receipt.errors[0].statusCode, 307, name);
  }
});

test('Delivery: a provider refuses to send its credentials over plain HTTP', () => {
  const insecure = 'http://api.example.com';
  const configs = [
    () => new ResendTransport({ apiKey: 'key', baseUrl: insecure }),
    () => new SendGridTransport({ apiKey: 'key', baseUrl: insecure }),
    () => new MailgunTransport({ apiKey: 'key', domain: 'mg.example.com', baseUrl: insecure }),
    () => new MailtrapTransport({ apiToken: 'token', sendBaseUrl: insecure }),
    () => new MailerooTransport({ apiKey: 'key', baseUrl: insecure }),
    () => new LettermintTransport({ apiToken: 'token', baseUrl: insecure }),
    () => new PlunkTransport({ apiKey: 'key', baseUrl: insecure }),
    () => new JmapTransport({ sessionUrl: `${insecure}/session`, bearerToken: 'token' }),
  ];
  for (const create of configs) assert.throws(create, TypeError);
  const local = new ResendTransport({ apiKey: 'key', baseUrl: 'http://localhost:8080' });
  assert.strictEqual(local.config.baseUrl, 'http://localhost:8080');
});

test('Delivery: a 2xx body longer than 4 MiB is refused, of unknown delivery', async (t) => {
  for (const [name, status, create] of providers) {
    t.mock.method(globalThis, 'fetch', async () => {
      let sentBytes = 0;
      const body = new ReadableStream({
        pull(controller) {
          if (sentBytes > 5 * 1024 * 1024) controller.close();
          else controller.enqueue(new Uint8Array(65536).fill(0x20));
          sentBytes += 65536;
        },
      });
      return new Response(body, { status });
    });
    const receipt = await create().send(message());
    t.mock.restoreAll();
    assert.strictEqual(receipt.deliveryUnknown, true, name);
    assert.match(receipt.errorMessages[0], /exceeds 4194304 bytes/, name);
  }
});

test('Delivery: the failure of fetch stays the cause of the provider error', async (t) => {
  const refused = new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
  });
  t.mock.method(globalThis, 'fetch', async () => {
    throw refused;
  });
  for (const [name, , create] of providers) {
    const transport = create({ retries: 0 });
    const body = name === 'Mailgun' ? new FormData() : {};
    // The clients ported from upyo send with sendMessage; those of 1.1 with
    // the request of the shared client.
    const sending = portedProviders.some((provider) => provider[0] === name)
      ? transport.httpClient.sendMessage(body, undefined)
      : transport.httpClient.request({ url: 'https://api.example.com/send', body: {} });
    const error = await sending.catch((caught) => caught);
    assert.ok(error instanceof Error, name);
    let cause = error;
    while (cause !== refused && cause?.cause != null) cause = cause.cause;
    assert.strictEqual(cause, refused, `${name}: ${error.name}`);
  }
});

test('Delivery: a lost request is not sent again without a key; a refused one is', async (t) => {
  const failed = (code) =>
    new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
  for (const [name, , create] of providers) {
    for (const code of ['ECONNRESET', 'ECONNREFUSED']) {
      let requests = 0;
      t.mock.method(globalThis, 'fetch', async () => {
        requests++;
        throw failed(code);
      });
      const receipt = await create().send(message());
      t.mock.restoreAll();
      if (code === 'ECONNREFUSED') {
        assert.strictEqual(requests, 2, `${name} ${code}`);
        assert.strictEqual(receipt.deliveryUnknown, undefined, `${name} ${code}`);
        assert.strictEqual(receipt.retryable, true, `${name} ${code}`);
      } else {
        assert.strictEqual(requests, expectedRequests(name), `${name} ${code}`);
        assert.strictEqual(receipt.deliveryUnknown, true, `${name} ${code}`);
      }
    }
  }
});

test('Delivery: a configured name cannot move a request to another host or path', async (t) => {
  const authentication = { type: 'credentials', accessKeyId: 'a', secretAccessKey: 'b' };
  assert.throws(() => new SesTransport({ authentication, region: 'foo@evil.example/' }), TypeError);
  const gov = new SesTransport({ authentication, region: 'us-gov-west-1' });
  assert.strictEqual(gov.config.region, 'us-gov-west-1');

  const paths = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    paths.push(new URL(url).pathname);
    return Response.json({ id: 'x', message: 'ok' });
  });
  await new MailgunTransport({ apiKey: 'key', domain: '../../admin', retries: 0 }).send(message());
  await new MailtrapTransport({
    apiToken: 'token',
    sandbox: true,
    inboxId: '1/../../admin',
    retries: 0,
  }).send(message());
  assert.deepStrictEqual(paths, ['/v3/..%2F..%2Fadmin/messages', '/api/send/1%2F..%2F..%2Fadmin']);
});

test('Delivery: every HTTP provider tells onRetry of its retries', async (t) => {
  // A 503, which is retried, then a 400, which is not; the providers run
  // together so that their delays before the retry overlap.
  const requests = new Map();
  t.mock.method(globalThis, 'fetch', async (url) => {
    const key = String(url);
    const count = (requests.get(key) ?? 0) + 1;
    requests.set(key, count);
    return new Response('{"message":"Busy"}', { status: count === 1 ? 503 : 400 });
  });
  await Promise.all(
    providers.map(async ([name, , create]) => {
      const events = [];
      const receipt = await create().send(message(), { onRetry: (event) => events.push(event) });
      assert.strictEqual(receipt.successful, false, name);
      assert.strictEqual(events.length, 1, name);
      assert.strictEqual(events[0].attempt, 1, name);
      assert.ok(events[0].delayMilliseconds > 0, name);
      assert.strictEqual(events[0].error.statusCode, 503, name);
    }),
  );
});

test('Delivery: every HTTP transport requests through the fetch it is given', async (t) => {
  const global = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('The global fetch was used.');
  });
  const jmap = (extra) =>
    new JmapTransport({
      sessionUrl: 'https://jmap.example.com/session',
      bearerToken: 't',
      ...extra,
    });
  for (const [name, , create] of [...providers, ['JMAP', 200, jmap]]) {
    const urls = [];
    const fetch = async (url) => {
      urls.push(String(url));
      return new Response('{"message":"No"}', { status: 400 });
    };
    const receipt = await create({ fetch }).send(message());
    assert.strictEqual(receipt.successful, false, name);
    assert.ok(urls.length > 0, name);
  }
  assert.strictEqual(global.mock.callCount(), 0);
});

test('Delivery: generateId makes the idempotency keys and the synthetic message IDs', async () => {
  const generateId = (kind) => `01JKEY-${kind}`;
  const sent = [];
  const fetch = async (url, init) => {
    sent.push(new Headers(init.headers));
    return new Response('not json', { status: 200 });
  };
  const resend = new ResendTransport({ apiKey: 'key', retries: 0, generateId, fetch });
  await resend.send(message());
  assert.strictEqual(sent.at(-1).get('idempotency-key'), '01JKEY-idempotency-key');
  const lettermint = new LettermintTransport({ apiToken: 'token', retries: 0, generateId, fetch });
  await lettermint.send(message());
  assert.strictEqual(sent.at(-1).get('idempotency-key'), '01JKEY-idempotency-key');

  const ok = async () => new Response('{}', { status: 200 });
  const ses = new SesTransport({
    authentication: { type: 'credentials', accessKeyId: 'a', secretAccessKey: 'b' },
    retries: 0,
    generateId,
    fetch: ok,
  });
  assert.strictEqual((await ses.send(message())).messageId, 'ses-01JKEY-receipt-id');
  const sendgrid = new SendGridTransport({
    apiKey: 'key',
    retries: 0,
    generateId,
    fetch: async () => new Response(null, { status: 202 }),
  });
  assert.strictEqual((await sendgrid.send(message())).messageId, 'sendgrid-01JKEY-receipt-id');
});

test('Delivery: the logger of an HTTP transport hears its retries, without addresses', async () => {
  const records = [];
  const logger = { debug: (properties, text) => records.push([properties, text]) };
  let requests = 0;
  const fetch = async () =>
    ++requests === 1
      ? new Response('{"message":"Mailbox of bob@example.com is busy"}', { status: 503 })
      : new Response('{"MessageId":"m1"}', { status: 200 });
  const ses = new SesTransport({
    authentication: { type: 'credentials', accessKeyId: 'a', secretAccessKey: 'b' },
    retries: 1,
    fetch,
    logger,
  });
  assert.strictEqual((await ses.send(message())).successful, true);
  assert.strictEqual(records.length, 1);
  const [properties, text] = records[0];
  assert.strictEqual(text, 'Retrying request');
  assert.strictEqual(properties.transport, 'ses');
  assert.strictEqual(properties.attempt, 1);
  assert.strictEqual(properties.statusCode, 503);
  assert.ok(properties.delayMilliseconds > 0);
  assert.ok(!JSON.stringify(records).includes('bob@example.com'), JSON.stringify(records));
});

test('Delivery: the matrix holds every HTTP provider of the exports map', () => {
  // Before: the contracts listed the providers by hand, so a provider added
  // to the exports map was not held to them.
  const fs = require('node:fs');
  const path = require('node:path');
  const pkg = require('../../package.json');
  const root = path.join(__dirname, '../..');
  const http = [];
  for (const key of Object.keys(pkg.exports)) {
    const subpath = key.slice(2);
    if (key === '.' || subpath === 'jmap') continue;
    if (fs.existsSync(path.join(root, 'src', subpath, 'http-client.js'))) http.push(subpath);
  }
  const inMatrix = [];
  for (const [, , create] of providers) inMatrix.push(create().id);
  assert.deepStrictEqual(inMatrix.sort(), http.sort());
});

test('Delivery: every HTTP provider refuses a plain HTTP URL but to this machine', () => {
  // Before: the refusal was checked for the providers ported from upyo alone.
  const insecure = 'http://api.example.com';
  for (const [name, , create] of providers) {
    if (name === 'SES') continue; // Its endpoint is made of its region alone.
    if (name === 'Azure') {
      assert.throws(
        () =>
          new AzureTransport({
            connectionString: `endpoint=${insecure}/;accesskey=${AZURE_KEY}`,
          }),
        TypeError,
        name,
      );
      continue;
    }
    const url = name === 'Mailtrap' ? { sendBaseUrl: insecure } : { baseUrl: insecure };
    assert.throws(() => create(url), TypeError, name);
  }
});

test('Delivery: every HTTP provider rejects with the reason of an abort, before or during', async (t) => {
  // Before: no contract held the providers to the reason of the caller's
  // signal, which a decorator tells apart from a failure.
  for (const [name, , create] of providers) {
    const seen = { requests: 0 };
    t.mock.method(globalThis, 'fetch', (_url, init) => {
      seen.requests++;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    });
    const early = new AbortController();
    const reason = new Error(`stopped ${name}`);
    early.abort(reason);
    await assert.rejects(create().send(message(), { signal: early.signal }), (error) => {
      assert.strictEqual(error, reason, name);
      return true;
    });
    assert.strictEqual(seen.requests, 0, name);
    const late = new AbortController();
    const sending = create().send(message(), { signal: late.signal });
    while (seen.requests === 0) await new Promise((resolve) => setImmediate(resolve));
    late.abort(reason);
    await assert.rejects(sending, (error) => {
      assert.strictEqual(error, reason, name);
      return true;
    });
    t.mock.restoreAll();
  }
});
