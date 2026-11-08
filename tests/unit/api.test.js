// Not ported: the shared client of the HTTP providers of 1.1
// (src/internal/api.js), against a stubbed fetch.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  ProviderApiError,
  checkCredential,
  createApiClient,
  providerFailure,
} = require('../../src/internal/api.js');
const { RefusalError } = require('../../src/internal/refusal.js');
const { isDeliveryUnknown } = require('../../src/internal/delivery-unknown.js');
const { json, stubFetch } = require('../helpers/providers/fetch.js');

const client = (config = {}, provider = {}) =>
  createApiClient(
    { retries: 0, timeout: 1000, headers: {}, ...config },
    {
      id: 'demo',
      label: 'Demo',
      authorize: (headers) => headers.set('Authorization', 'Bearer key'),
      ...provider,
    },
  );

test('API: the message of an error comes from the fields most APIs use', async (t) => {
  const answers = [
    json({ message: 'a' }, 400),
    json({ Message: 'b' }, 400),
    json({ error: 'c' }, 400),
    json({ error: { message: 'd' } }, 400),
    json({ errors: ['e'] }, 400),
    json({ errors: [{ message: 'f' }] }, 400),
    json({ other: true }, 400),
    new Response('plain text', { status: 400 }),
    new Response('', { status: 418 }),
    new Response('x'.repeat(700), { status: 400 }),
  ];
  stubFetch(t, () => answers.shift());
  const messages = [];
  for (let i = 0; i < 10; i++) {
    await client()
      .request({ url: 'https://api.example.com/send', body: {} })
      .catch((error) => messages.push(error.message));
  }
  assert.deepStrictEqual(messages.slice(0, 9), [
    'Demo: a',
    'Demo: b',
    'Demo: c',
    'Demo: d',
    'Demo: e',
    'Demo: f',
    'Demo: {"other":true}',
    'Demo: plain text',
    'Demo: HTTP 418',
  ]);
  assert.ok(messages[9].length < 520);
});

test('API: headers of the config, a form body, an empty answer', async (t) => {
  const requests = stubFetch(t, () => new Response(null, { status: 202 }));
  const form = new FormData();
  form.append('to', 'a@example.com');
  const answer = await client({ headers: { 'X-Team': 'mail' } }).request({
    url: 'https://api.example.com/send',
    body: form,
    headers: { 'X-One': '1' },
  });
  assert.deepStrictEqual({ status: answer.status, json: answer.json }, { status: 202, json: null });
  const [request] = requests;
  assert.strictEqual(request.body, form);
  assert.strictEqual(request.headers.get('x-team'), 'mail');
  assert.strictEqual(request.headers.get('x-one'), '1');
  assert.strictEqual(request.headers.get('authorization'), 'Bearer key');
  assert.strictEqual(request.headers.get('content-type'), null);
});

test('API: a timeout, and a network failure once retries are spent', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    (input, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      }),
  );
  await assert.rejects(
    client({ timeout: 20 }).request({ url: 'https://api.example.com/send', body: {} }),
    (error) => {
      assert.ok(error instanceof ProviderApiError);
      assert.strictEqual(error.message, 'Demo API request timed out after 20 ms.');
      return true;
    },
  );
  const refused = Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
  });
  t.mock.method(globalThis, 'fetch', async () => {
    throw refused;
  });
  await assert.rejects(
    client().request({ url: 'https://api.example.com/send', body: {}, isIdempotent: true }),
    (error) => {
      assert.ok(error instanceof ProviderApiError);
      assert.strictEqual(error.message, 'Demo: fetch failed');
      assert.strictEqual(error.cause, refused);
      assert.strictEqual(error.attempts, 1);
      return true;
    },
  );
});

test('API: the receipt of a failure carries what the error says', () => {
  const error = new ProviderApiError('demo', 'Demo: refused', {
    statusCode: 422,
    category: 'rejected',
    retryable: false,
    code: 'demo.7',
    providerDetails: { reason: 'x' },
  });
  const receipt = providerFailure('demo', error);
  assert.strictEqual(receipt.errors[0].category, 'rejected');
  assert.strictEqual(receipt.errors[0].code, 'demo.7');
  assert.strictEqual(receipt.errors[0].statusCode, 422);
  assert.strictEqual(receipt.retryable, false);
  assert.strictEqual(isDeliveryUnknown(error), false);
  const plain = providerFailure('demo', 'just text');
  assert.deepStrictEqual(plain.errorMessages, ['just text']);
  assert.throws(
    () => checkCredential(undefined, 'apiKey', 'DemoTransport'),
    /DemoTransport needs apiKey/,
  );
  assert.throws(() => checkCredential('', 'apiKey', 'DemoTransport'), TypeError);
  assert.strictEqual(checkCredential('k', 'apiKey', 'DemoTransport'), 'k');
});

test('API: a refusal of the converter is a non-retryable unsupported failure', () => {
  const refused = providerFailure('x', new RefusalError('X takes at most 5 tags.'));
  assert.strictEqual(refused.errors[0].category, 'unsupported');
  assert.strictEqual(refused.errors[0].code, 'unsupported');
  assert.strictEqual(refused.retryable, false);
  assert.strictEqual(refused.errorMessages[0], 'X takes at most 5 tags.');
  const other = providerFailure('x', new Error('boom'));
  assert.notStrictEqual(other.errors[0].category, 'unsupported');
  // Another RangeError, such as a body over its limit, keeps its own receipt.
  const range = providerFailure('x', new RangeError('The body is over 4 MiB.'));
  assert.notStrictEqual(range.errors[0].category, 'unsupported');
});

test('API: every HTTP provider requests through createApiClient, but JMAP', () => {
  // Before: the seven clients ported from upyo each carried their own fetch,
  // retry wiring, timeouts and truncation, and a fix of one (bug 29) missed
  // another. SES signs each attempt in its authorize; JMAP has its own session.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = path.join(__dirname, '../../src');
  const direct = [];
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const file = path.join(src, entry.name, 'http-client.js');
    if (!entry.isDirectory() || !fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('requestWithRetry')) direct.push(entry.name);
    else assert.match(text, /createApiClient\(/, entry.name);
  }
  assert.deepStrictEqual(direct, ['jmap']);
});

test('API: the errors of 1.0 keep their names, arguments and fields over the shared error', () => {
  const { SendGridApiError } = require('../../src/sendgrid/index.js');
  const { MailgunApiError } = require('../../src/mailgun/index.js');
  const maileroo = require('../../src/maileroo/index.js');
  const lettermint = require('../../src/lettermint/index.js');
  const mailtrap = require('../../src/mailtrap/index.js');
  const sendgrid = new SendGridApiError('bad', 400, [{ message: 'x' }], 1000, 2, { cause: 'c' });
  assert.ok(sendgrid instanceof Error && sendgrid instanceof ProviderApiError);
  assert.deepStrictEqual(
    [sendgrid.name, sendgrid.message, sendgrid.statusCode, sendgrid.retryAfterMilliseconds],
    ['SendGridApiError', 'bad', 400, 1000],
  );
  assert.deepStrictEqual(sendgrid.errors, [{ message: 'x' }]);
  assert.deepStrictEqual([sendgrid.attempts, sendgrid.cause], [2, 'c']);
  assert.deepStrictEqual(providerFailure('sendgrid', sendgrid).errors[0].providerDetails, [
    { message: 'x' },
  ]);
  const mailgun = new MailgunApiError('down', 503, undefined, 3);
  assert.deepStrictEqual(
    [mailgun.name, mailgun.statusCode, mailgun.attempts],
    ['MailgunApiError', 503, 3],
  );
  for (const [module, prefix] of [
    [maileroo, 'Maileroo'],
    [lettermint, 'Lettermint'],
    [mailtrap, 'Mailtrap'],
  ]) {
    const api = new module[`${prefix}ApiError`]('no', 401, 5, 1);
    assert.deepStrictEqual(
      [api.name, api.statusCode, api.retryAfterMilliseconds, api.attempts],
      [`${prefix}ApiError`, 401, 5, 1],
    );
    const timeout = new module[`${prefix}TimeoutError`](1500, 2);
    assert.deepStrictEqual(
      [timeout.name, timeout.timeout, timeout.attempts],
      [`${prefix}TimeoutError`, 1500, 2],
    );
    assert.strictEqual(timeout.message, `${prefix} API request timed out after 1500 ms.`);
    const receipt = providerFailure(prefix.toLowerCase(), timeout);
    assert.deepStrictEqual(
      [receipt.errors[0].category, receipt.errors[0].code, receipt.retryable, receipt.attempts],
      ['timeout', 'timeout', true, 2],
    );
  }
  const read = new mailtrap.MailtrapResponseError(new mailtrap.MailtrapTimeoutError(10), 1);
  assert.deepStrictEqual(
    [read.name, read.attempts, read.retryable],
    ['MailtrapResponseError', 1, false],
  );
  assert.strictEqual(providerFailure('mailtrap', read).errors[0].category, 'timeout');
});

test('API: a form, a string and bytes go as they are, with the type the caller gave', async (t) => {
  const requests = stubFetch(t, () => json({ id: '1' }));
  const signed = [];
  const demo = client({}, { authorize: (headers, request) => signed.push(request.body) });
  const form = new URLSearchParams({ To: '+380671234567', Body: 'Code 1234' });
  await demo.request({ url: 'https://api.example.com/sms', body: form });
  await demo.request({
    url: 'https://sms-voice.us-east-1.amazonaws.com/',
    body: '{"DestinationPhoneNumber":"+380671234567"}',
    headers: { 'content-type': 'application/x-amz-json-1.0', accept: 'application/json' },
  });
  await demo.request({ url: 'https://push.example.com/1', body: new Uint8Array([1, 2]) });
  await demo.request({
    url: 'https://push.example.com/2',
    body: new Uint8Array([3]),
    headers: { 'Content-Type': 'application/webpush' },
  });
  // A JSON body keeps a type of the caller's in lower case, rather than both.
  await demo.request({
    url: 'https://api.example.com/json',
    body: { a: 1 },
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
  assert.strictEqual(requests[0].body, 'To=%2B380671234567&Body=Code+1234');
  assert.strictEqual(requests[0].form.get('To'), '+380671234567');
  assert.strictEqual(requests[0].headers.get('content-type'), 'application/x-www-form-urlencoded');
  // The signature reads the body as it goes.
  assert.strictEqual(signed[0], requests[0].body);
  assert.strictEqual(requests[1].headers.get('content-type'), 'application/x-amz-json-1.0');
  assert.strictEqual(requests[1].headers.get('accept'), 'application/json');
  assert.strictEqual(requests[1].json.DestinationPhoneNumber, '+380671234567');
  assert.deepStrictEqual(requests[2].body, new Uint8Array([1, 2]));
  assert.strictEqual(requests[2].headers.get('content-type'), 'application/octet-stream');
  assert.strictEqual(requests[3].headers.get('content-type'), 'application/webpush');
  assert.strictEqual(requests[4].headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepStrictEqual(requests[4].json, { a: 1 });
});

test('API: the wait of a body, a rate limit in a 400, and the delays of the provider', async (t) => {
  const answers = [
    json({ ok: false, error_code: 429, parameters: { retry_after: 3 } }, 429),
    json({ error: { code: 4, message: 'Application request limit reached' } }, 400),
    json({ ok: true }),
  ];
  stubFetch(t, () => answers.shift());
  const waits = [];
  const delays = [];
  const answer = await client(
    { retries: 2 },
    {
      classify: (status, body, headers) => {
        assert.ok(headers instanceof Headers);
        if (body?.parameters?.retry_after !== undefined) {
          return { category: 'rate-limit', retryable: true, retryAfterMilliseconds: 3000 };
        }
        return body?.error?.code === 4 ? { category: 'rate-limit', retryable: true } : {};
      },
      retryDelayMs: (attempt) => {
        delays.push(attempt);
        return 10;
      },
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      },
    },
  ).request({ url: 'https://api.example.com/send', body: {}, hasIdempotencyKey: true });
  assert.deepStrictEqual(answer.json, { ok: true });
  assert.deepStrictEqual(delays, [0, 1]);
  // At least the wait the body asked for, then the provider's own delay.
  assert.deepStrictEqual(waits, [3000, 10]);
});

test('API: a request reads an answer of its own, and takes a status as one', async (t) => {
  const answers = [new Response('ok', { status: 200 }), new Response('gone', { status: 404 })];
  stubFetch(t, () => answers.shift());
  const demo = client();
  const text = await demo.request({
    url: 'https://hooks.slack.com/services/T/B/X',
    body: { text: 'Deployed' },
    read: (response, body) => ({ status: response.status, text: body }),
  });
  assert.deepStrictEqual(text, { status: 200, text: 'ok' });
  const missing = await demo.request({
    url: 'https://api.example.com/token',
    method: 'GET',
    accepts: (status) => status === 404,
    read: (response, body) => ({ status: response.status, text: body }),
  });
  assert.deepStrictEqual(missing, { status: 404, text: 'gone' });
});

test('API: authorize hears the signal of the attempt, for a token it waits for', async (t) => {
  stubFetch(t, () => json({ id: '1' }));
  const signals = [];
  const caller = new AbortController();
  await client({}, { authorize: (headers, request) => signals.push(request.signal) }).request({
    url: 'https://api.example.com/send',
    body: {},
    signal: caller.signal,
  });
  assert.ok(signals[0] instanceof AbortSignal);
  caller.abort();
  assert.ok(signals[0].aborted);
});

test('API: a request that failed before it was sent is not of unknown delivery', async (t) => {
  // Before (C4): a deadline met while the request waited for its token, a
  // credentials provider that threw and a header field Headers refused were
  // failures without a response, so of unknown delivery, though nothing was
  // sent; the last printed the value of the header, a credential.
  const requests = stubFetch(t, () => json({ ok: true }));
  const waiting = client(
    { timeout: 30 },
    {
      authorize: (_headers, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason)),
        ),
    },
  );
  const timedOut = await waiting
    .request({ url: 'https://api.example.com/send', body: {} })
    .catch((error) => error);
  assert.strictEqual(isDeliveryUnknown(timedOut), false, 'nothing was sent');
  assert.strictEqual(providerFailure('demo', timedOut).deliveryUnknown, undefined);
  assert.strictEqual(providerFailure('demo', timedOut).errors[0].category, 'timeout');
  const thrown = await client(
    {},
    {
      authorize: async () => {
        throw new Error('Could not load credentials from any providers');
      },
    },
  )
    .request({ url: 'https://api.example.com/send', body: {} })
    .catch((error) => error);
  assert.strictEqual(isDeliveryUnknown(thrown), false);
  assert.match(thrown.message, /Could not load credentials/);
  const header = await client(
    {},
    {
      authorize: (headers) => headers.set('Authorization', 'App secret-key\nsecond'),
    },
  )
    .request({ url: 'https://api.example.com/send', body: {} })
    .catch((error) => error);
  assert.strictEqual(isDeliveryUnknown(header), false);
  assert.ok(!header.message.includes('secret-key'), header.message);
  assert.strictEqual(providerFailure('demo', header).errors[0].category, 'configuration');
  assert.strictEqual(requests.length, 0);
  // A deadline met while the token is awaited is retried, as nothing went.
  let asked = 0;
  const later = client(
    { timeout: 30, retries: 1 },
    {
      authorize: (headers, { signal }) =>
        ++asked === 1
          ? new Promise((_resolve, reject) =>
              signal.addEventListener('abort', () => reject(signal.reason)),
            )
          : headers.set('Authorization', 'Bearer key'),
      retryDelayMs: () => 0,
    },
  );
  await later.request({ url: 'https://api.example.com/send', body: {} });
  assert.strictEqual(requests.length, 1);
});
