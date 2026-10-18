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

test('API: every HTTP provider requests through createApiClient, but SES and JMAP', () => {
  // Before: the seven clients ported from upyo each carried their own fetch,
  // retry wiring, timeouts and truncation, and a fix of one (bug 29) missed
  // another. SES signs each attempt with SigV4 and JMAP has its own session.
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
  assert.deepStrictEqual(direct.sort(), ['jmap', 'ses']);
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
