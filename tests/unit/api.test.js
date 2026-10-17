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

test('API: a refusal of the converter is a non-retryable validation failure', () => {
  const refused = providerFailure('x', new RefusalError('X takes at most 5 tags.'));
  assert.strictEqual(refused.errors[0].category, 'validation');
  assert.strictEqual(refused.retryable, false);
  assert.strictEqual(refused.errorMessages[0], 'X takes at most 5 tags.');
  const other = providerFailure('x', new Error('boom'));
  assert.notStrictEqual(other.errors[0].category, 'validation');
  // Another RangeError, such as a body over its limit, keeps its own receipt.
  const range = providerFailure('x', new RangeError('The body is over 4 MiB.'));
  assert.notStrictEqual(range.errors[0].category, 'validation');
});
