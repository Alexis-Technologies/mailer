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
const {
  checkRequestOptions,
  exponentialDelayMs,
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
  const { request, sends } = scripted([unreadable]);
  const error = await requestWithRetry(request).catch((caught) => caught);
  assert.strictEqual(sends(), 1);
  assert.strictEqual(isDeliveryUnknown(error), true);

  const wrapped = scripted([unreadable], {
    wrapAccepted: (cause) => new Error('wrapped', { cause }),
  });
  const wrapping = await requestWithRetry(wrapped.request).catch((caught) => caught);
  assert.strictEqual(wrapping.message, 'wrapped');
  assert.strictEqual(isDeliveryUnknown(wrapping), true);

  const refusal = new RejectedError('Refused in the body.');
  const answered = scripted([new Response('{}')], {
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
  const body = scripted([slowBody], { timeoutMs: 5, retries: 0 });
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
