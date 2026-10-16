// The private modules of src/internal/ that the subpaths share.
const { test } = require('node:test');
const assert = require('node:assert');
const { isUnsentRequestError } = require('../../src/internal/unsent.js');

const fetchFailed = (code) =>
  new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });

test('Internal: a request whose connection was never made was not sent', () => {
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'CERT_HAS_EXPIRED']) {
    assert.strictEqual(isUnsentRequestError(fetchFailed(code)), true, code);
  }
  const wrapped = new Error('JMAP request failed', { cause: fetchFailed('ECONNREFUSED') });
  assert.strictEqual(isUnsentRequestError(wrapped), true);
});

test('Internal: a reset, a timeout or a failure without a cause may have been sent', () => {
  for (const error of [
    fetchFailed('ECONNRESET'),
    new DOMException('The operation timed out.', 'TimeoutError'),
    new TypeError('fetch failed'),
    null,
  ]) {
    assert.strictEqual(isUnsentRequestError(error), false);
  }
});

const { isDeliveryUnknown } = require('../../src/internal/delivery-unknown.js');
const { checkRequestOptions, checkSecureUrl } = require('../../src/internal/config.js');
const {
  exponentialDelayMs,
  isRetryableStatus,
  jitteredDelayMs,
  requestWithRetry,
} = require('../../src/internal/http.js');

class RejectedError extends Error {}

// A request whose fetches answer in turn with `responses` (a Response, an
// error to throw, or a function of the attempt's signal).
const scripted = (responses, overrides = {}) => {
  const delays = [];
  let sends = 0;
  const request = {
    retries: 2,
    timeoutMs: 1000,
    // The retry mechanics, apart from the rules of an ambiguous failure.
    isIdempotent: true,
    send: async (signal) => {
      const next = responses[Math.min(sends++, responses.length - 1)];
      if (typeof next === 'function') return next(signal);
      if (next instanceof Error) throw next;
      return next;
    },
    read: async (response) => response.text(),
    reject: async (response) => new RejectedError(`HTTP ${response.status}`),
    isRetryable: (error) => !(error instanceof RejectedError),
    retryDelayMs: (attempt) => attempt + 1,
    createTimeoutError: () => new Error('Timed out.'),
    finalError: (error, attempts) => Object.assign(error, { attempts }),
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    ...overrides,
  };
  return { request, delays, sends: () => sends };
};

test('Internal: a retryable failure is retried after its delay, then the read result returned', async () => {
  const { request, delays, sends } = scripted([new TypeError('fetch failed'), new Response('ok')]);
  assert.strictEqual(await requestWithRetry(request), 'ok');
  assert.strictEqual(sends(), 2);
  assert.deepStrictEqual(delays, [1]);
});

test('Internal: a failure that is not retryable is thrown at once, the last one with attempts', async () => {
  const rejected = scripted([new Response('no', { status: 400 })]);
  await assert.rejects(requestWithRetry(rejected.request), RejectedError);
  assert.strictEqual(rejected.sends(), 1);

  const spent = scripted([new TypeError('fetch failed')]);
  await assert.rejects(requestWithRetry(spent.request), { message: 'fetch failed', attempts: 3 });
  assert.deepStrictEqual(spent.delays, [1, 2]);
});

test('Internal: a failure after a 2xx is not retried and is of unknown delivery', async () => {
  const unreadable = () => {
    const response = new Response(null, { status: 200 });
    Object.defineProperty(response, 'text', { value: () => Promise.reject(new Error('reset')) });
    return response;
  };
  const { request, sends } = scripted([unreadable], { isIdempotent: false });
  const error = await requestWithRetry(request).catch((caught) => caught);
  assert.strictEqual(sends(), 1);
  assert.strictEqual(isDeliveryUnknown(error), true);

  const wrapped = scripted([unreadable], {
    isIdempotent: false,
    wrapAccepted: (cause) => new Error('wrapped', { cause }),
  });
  const wrapping = await requestWithRetry(wrapped.request).catch((caught) => caught);
  assert.strictEqual(wrapping.message, 'wrapped');
  assert.strictEqual(isDeliveryUnknown(wrapping), true);

  const refusal = new RejectedError('Refused in the body.');
  const answered = scripted([new Response('{}')], {
    isIdempotent: false,
    read: async () => {
      throw refusal;
    },
    isAnswer: (failure) => failure instanceof RejectedError,
  });
  const answer = await requestWithRetry(answered.request).catch((caught) => caught);
  assert.strictEqual(answer, refusal);
  assert.strictEqual(isDeliveryUnknown(answer), false);

  const idempotent = scripted([unreadable, new Response('ok')], { isIdempotent: true });
  assert.strictEqual(await requestWithRetry(idempotent.request), 'ok');
  assert.strictEqual(idempotent.sends(), 2);
});

test('Internal: an expired deadline gives the timeout error, over the body too', async () => {
  const hang = (signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  const headers = scripted([hang], { timeoutMs: 5, retries: 0 });
  await assert.rejects(requestWithRetry(headers.request), { message: 'Timed out.' });

  const slowBody = (signal) => {
    const response = new Response(null, { status: 200 });
    Object.defineProperty(response, 'text', { value: () => hang(signal) });
    return response;
  };
  const body = scripted([slowBody], { timeoutMs: 5, retries: 0, isIdempotent: false });
  const error = await requestWithRetry(body.request).catch((caught) => caught);
  assert.strictEqual(error.message, 'Timed out.');
  assert.strictEqual(isDeliveryUnknown(error), true);

  const late = (signal) =>
    new Promise((resolve) => setTimeout(() => resolve(new Response(String(signal.aborted))), 5));
  const disabled = scripted([late], { timeoutMs: 0, isZeroTimeoutDisabled: true });
  assert.strictEqual(await requestWithRetry(disabled.request), 'false');
});

test('Internal: an abort of the caller ends the retries with its reason', async () => {
  const controller = new AbortController();
  const reason = new Error('Stopped by the caller.');
  const { request } = scripted([new TypeError('fetch failed')], {
    signal: controller.signal,
    sleep: undefined,
    retryDelayMs: () => 60_000,
  });
  const pending = requestWithRetry(request);
  setTimeout(() => controller.abort(reason), 5);
  await assert.rejects(pending, (error) => error === reason);
});

test('Internal: delays double from one second, and the jittered one stays in its upper half', () => {
  assert.deepStrictEqual([0, 1, 2, 3].map(exponentialDelayMs), [1000, 2000, 4000, 8000]);
  for (let attempt = 0; attempt < 8; attempt++) {
    const baseMs = Math.min(1000 * 2 ** attempt, 10_000);
    const delayMs = jitteredDelayMs(attempt);
    assert.ok(delayMs >= baseMs / 2 && delayMs <= baseMs, String(delayMs));
  }
});

test('Internal: a timeout is a number of milliseconds or none, retries a whole number', () => {
  for (const timeoutMs of [0, 1, 30_000, Infinity]) checkRequestOptions(timeoutMs, 0);
  for (const timeoutMs of [-1, Number.NaN, '30000', undefined]) {
    assert.throws(() => checkRequestOptions(timeoutMs, 3), RangeError);
  }
  for (const retries of [-1, 1.5, Infinity, '3']) {
    assert.throws(() => checkRequestOptions(30_000, retries), RangeError);
  }
});

test('Internal: a Retry-After is waited for, and not when it is longer than half a minute', async () => {
  const busy = (retryAfterMilliseconds) =>
    Object.assign(new Error('Busy'), { retryAfterMilliseconds });
  const soon = scripted([busy(1500), new Response('ok')]);
  assert.strictEqual(await requestWithRetry(soon.request), 'ok');
  assert.deepStrictEqual(soon.delays, [1500]);

  const later = scripted([busy(60_000), new Response('ok')]);
  await assert.rejects(requestWithRetry(later.request), { message: 'Busy', attempts: 1 });
  assert.strictEqual(later.sends(), 1);
  assert.deepStrictEqual(later.delays, []);
});

test('Internal: a timeout, a rate limit and a server error are retried by default', async () => {
  assert.deepStrictEqual([400, 401, 404, 408, 422, 429, 500, 503, 301].map(isRetryableStatus), [
    false,
    false,
    false,
    true,
    false,
    true,
    true,
    true,
    false,
  ]);
  const reject = async (response) =>
    Object.assign(new Error('HTTP'), { statusCode: response.status });
  const limited = scripted([new Response('', { status: 429 }), new Response('ok')], {
    reject,
    isRetryable: undefined,
    retryDelayMs: undefined,
  });
  assert.strictEqual(await requestWithRetry(limited.request), 'ok');
  assert.ok(limited.delays[0] >= 500 && limited.delays[0] <= 1000, String(limited.delays[0]));
  const refused = scripted([new Response('', { status: 400 })], { reject, isRetryable: undefined });
  await assert.rejects(requestWithRetry(refused.request), { statusCode: 400 });
  assert.strictEqual(refused.sends(), 1);
});

test('Internal: a provider URL is HTTPS, or plain HTTP only to a loopback host', () => {
  const allowed = [
    'https://api.example.com/v1',
    'http://localhost:8080',
    'http://mail.localhost/',
    'http://127.0.0.1:3000',
    'http://127.1/',
    'http://[::1]:8080/',
  ];
  for (const url of allowed) checkSecureUrl(url, 'baseUrl');
  for (const url of ['http://api.example.com', 'http://10.0.0.1/', 'ftp://a.example', 'nope']) {
    assert.throws(() => checkSecureUrl(url, 'baseUrl'), TypeError, url);
  }
});

const { readJson, readText } = require('../../src/internal/body.js');

// A body of `chunks` chunks of `size` bytes, counting how many were pulled.
const counted = (chunks, size) => {
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (pulled === chunks) {
        controller.close();
        return;
      }
      pulled++;
      controller.enqueue(new Uint8Array(size).fill(0x61));
    },
  });
  return { stream, pulled: () => pulled };
};

test('Internal: a body is read within its bound, as text or JSON', async () => {
  const split = new TextEncoder().encode('{"name":"Дуже"}');
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(split.subarray(0, 11));
      controller.enqueue(split.subarray(11));
      controller.close();
    },
  });
  assert.deepStrictEqual(await readJson(new Response(body)), { name: 'Дуже' });
  assert.strictEqual(await readText(new Response(null)), '');

  const long = counted(100, 1024);
  await assert.rejects(readText(new Response(long.stream), 10 * 1024), RangeError);
  assert.ok(long.pulled() < 20, String(long.pulled()));

  const declared = new Response('small', { headers: { 'Content-Length': '999999999' } });
  await assert.rejects(readText(declared), RangeError);
});

test('Internal: an ambiguous failure of a send is not retried, unless it has a key', async () => {
  const refused = new TypeError('fetch failed', {
    cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
  });
  const reset = new TypeError('fetch failed', {
    cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
  });
  const reject = async (response) =>
    Object.assign(new Error('HTTP'), { statusCode: response.status });
  const plain = { isIdempotent: false, reject };

  const lost = scripted([reset, new Response('ok')], plain);
  const lostError = await requestWithRetry(lost.request).catch((caught) => caught);
  assert.strictEqual(lost.sends(), 1);
  assert.strictEqual(isDeliveryUnknown(lostError), true);

  const gateway = scripted([new Response('', { status: 504 }), new Response('ok')], plain);
  const gatewayError = await requestWithRetry(gateway.request).catch((caught) => caught);
  assert.strictEqual(gateway.sends(), 1);
  assert.strictEqual(isDeliveryUnknown(gatewayError), true);

  const never = scripted([refused, new Response('ok')], plain);
  assert.strictEqual(await requestWithRetry(never.request), 'ok');
  assert.strictEqual(never.sends(), 2);

  const keyed = scripted([reset, new Response('', { status: 503 })], {
    ...plain,
    hasIdempotencyKey: true,
    retries: 1,
  });
  const keyedError = await requestWithRetry(keyed.request).catch((caught) => caught);
  assert.strictEqual(keyed.sends(), 2);
  assert.strictEqual(isDeliveryUnknown(keyedError), true);

  const read = scripted([reset, new Response('', { status: 503 })], { reject, retries: 1 });
  const readError = await requestWithRetry(read.request).catch((caught) => caught);
  assert.strictEqual(read.sends(), 2);
  assert.strictEqual(isDeliveryUnknown(readError), false);
});
