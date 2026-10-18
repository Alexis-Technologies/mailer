// The private modules of src/internal/ that the subpaths share.
const { test } = require('node:test');
const assert = require('node:assert');
const { isUnsentRequestError } = require('../../src/internal/unsent.js');

const fetchFailed = (code) =>
  new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });

test('Internal: a request whose connection was never made was not sent', () => {
  const codes = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'CERT_HAS_EXPIRED'];
  for (const code of [...codes, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']) {
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

test('Internal: onRetry hears each retry, with its attempt, wait and error, before the wait', async () => {
  const events = [];
  const failure = new TypeError('fetch failed');
  const busy = Object.assign(new Error('Busy'), { retryAfterMilliseconds: 1500 });
  const { request, delays } = scripted([failure, busy, new Response('ok')], {
    onRetry: (event) => events.push({ ...event, waitedBefore: delays.length }),
  });
  assert.strictEqual(await requestWithRetry(request), 'ok');
  assert.deepStrictEqual(events, [
    { attempt: 1, delayMilliseconds: 1, error: failure, waitedBefore: 0 },
    { attempt: 2, delayMilliseconds: 1500, error: busy, waitedBefore: 1 },
  ]);
  assert.deepStrictEqual(delays, [1, 1500]);
});

test('Internal: one loopback rule serves SMTP, OAuth 2.0 and the HTTP providers', () => {
  const { isLoopbackAddress, isLoopbackHost } = require('../../src/internal/loopback.js');
  const { OAuth2TokenManager } = require('../../src/smtp/oauth2.js');
  const loopback = [
    'localhost',
    'LOCALHOST.',
    'mail.localhost',
    '127.0.0.1',
    '127.12.0.3',
    '::1',
    '[::1]',
    '::ffff:127.0.0.1',
    '0:0:0:0:0:0:0:1',
    '::1%lo0',
  ];
  for (const host of loopback) assert.strictEqual(isLoopbackHost(host), true, host);
  for (const host of [
    'example.com',
    'localhost.example.com',
    '10.0.0.1',
    '::2',
    '::ffff:10.0.0.1',
    '127.1',
  ]) {
    assert.strictEqual(isLoopbackHost(host), false, host);
  }
  assert.strictEqual(isLoopbackAddress('localhost'), false);

  // The token endpoint of OAuth 2.0 used to allow only four spellings.
  const refresh = (tokenEndpoint) => ({
    type: 'oauth2',
    user: 'u',
    clientId: 'id',
    clientSecret: 'secret',
    refreshToken: 'refresh',
    tokenEndpoint,
  });
  for (const endpoint of [
    'http://127.0.0.2/token',
    'http://auth.localhost/token',
    'http://[::ffff:7f00:1]/',
  ]) {
    assert.doesNotThrow(() => new OAuth2TokenManager(refresh(endpoint)), endpoint);
  }
  assert.throws(() => new OAuth2TokenManager(refresh('http://auth.example.com/token')), TypeError);
});

test('Internal: a log binds its component, builds records lazily, and never throws', (t) => {
  const { createLog, warnDegradation } = require('../../src/internal/log.js');
  const records = [];
  const pinoLike = (bindings = {}) => ({
    child: (more) => pinoLike({ ...bindings, ...more }),
    isLevelEnabled: (level) => level !== 'trace',
    debug: (properties, message) =>
      records.push(['debug', { ...bindings, ...properties }, message]),
    trace: () => assert.fail('trace is not enabled'),
    warn: (properties, message) => records.push(['warn', { ...bindings, ...properties }, message]),
  });
  const log = createLog(pinoLike(), { transport: 'smtp' });
  log.write('debug', { step: 'connect' }, 'Connected.');
  log.write('trace', () => assert.fail('built for a level not written'), 'Never.');
  log.write('info', { step: 'none' }, 'No info method.');
  // A logger without child() gets the bindings in each record.
  const plain = [];
  createLog({ debug: (properties) => plain.push(properties) }, { transport: 'ses' }).write(
    'debug',
    { attempt: 1 },
    'Retrying.',
  );
  assert.deepStrictEqual(records, [
    ['debug', { transport: 'smtp', step: 'connect' }, 'Connected.'],
  ]);
  assert.deepStrictEqual(plain, [{ transport: 'ses', attempt: 1 }]);

  const warnings = t.mock.method(process, 'emitWarning', () => {});
  createLog(
    {
      debug: () => {
        throw new Error('Sink down');
      },
    },
    {},
  ).write('debug', {}, 'x');
  assert.strictEqual(warnings.mock.calls[0].arguments[1].code, 'MAILER_LOGGER_FAILED');

  // A degradation goes to the logger, or to console.warn without one.
  warnDegradation(log, 'MAILER_SMTP_PLAINTEXT', 'Sent without TLS.', { host: 'mx' });
  assert.deepStrictEqual(records.at(-1), [
    'warn',
    { transport: 'smtp', code: 'MAILER_SMTP_PLAINTEXT', host: 'mx' },
    'Sent without TLS.',
  ]);
  const consoleWarn = t.mock.method(console, 'warn', () => {});
  warnDegradation(createLog(undefined, {}), 'MAILER_DKIM_UNSIGNED', 'Sent unsigned.');
  assert.deepStrictEqual(consoleWarn.mock.calls[0].arguments, [
    'MAILER_DKIM_UNSIGNED: Sent unsigned.',
  ]);
  createLog(undefined, {}).write('warn', () => assert.fail('no logger'), 'x');
  assert.strictEqual(createLog(undefined, {}).isEnabled('warn'), false);
});

test('Internal: sendConcurrently keeps the order and at most `limit` sends at once', async () => {
  const { sendConcurrently } = require('../../src/internal/batch.js');
  let read = 0;
  let inFlight = 0;
  let most = 0;
  const messages = (function* () {
    for (let index = 0; index < 6; index++) {
      read++;
      yield index;
    }
  })();
  // Later messages finish sooner, so the receipts come back out of order.
  const send = async (index) => {
    inFlight++;
    most = Math.max(most, inFlight);
    await new Promise((resolve) => setTimeout(resolve, (6 - index) * 2));
    inFlight--;
    return index;
  };
  const receipts = [];
  for await (const receipt of sendConcurrently(messages, 3, send)) {
    receipts.push(receipt);
    if (receipts.length === 1) assert.ok(read <= 3, `read ${read} before the first receipt`);
  }
  assert.deepStrictEqual(receipts, [0, 1, 2, 3, 4, 5]);
  assert.strictEqual(most, 3);
});

test('Internal: sendConcurrently with a limit of 1 reads after each receipt', async () => {
  const { sendConcurrently } = require('../../src/internal/batch.js');
  const events = [];
  const messages = (async function* () {
    for (let index = 0; index < 3; index++) {
      events.push(`read ${index}`);
      yield index;
    }
  })();
  for await (const receipt of sendConcurrently(messages, 1, async (index) => index)) {
    events.push(`receipt ${receipt}`);
  }
  assert.deepStrictEqual(events, [
    'read 0',
    'receipt 0',
    'read 1',
    'receipt 1',
    'read 2',
    'receipt 2',
  ]);
});

test('Internal: sendConcurrently closes its input early and surfaces failures in turn', async (t) => {
  const { sendConcurrently } = require('../../src/internal/batch.js');
  let closed = false;
  const messages = (function* () {
    try {
      for (let index = 0; ; index++) yield index;
    } finally {
      closed = true;
    }
  })();
  for await (const receipt of sendConcurrently(messages, 2, async (index) => index)) {
    assert.strictEqual(receipt, 0);
    break;
  }
  assert.ok(closed);

  // A later send that fails while an earlier one is awaited is no unhandled
  // rejection; its error comes when its turn does.
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  const send = async (index) => {
    if (index === 1) throw new Error('second failed');
    await new Promise((resolve) => setTimeout(resolve, 10));
    return index;
  };
  const receipts = [];
  await assert.rejects(async () => {
    for await (const receipt of sendConcurrently([0, 1, 2], 3, send)) receipts.push(receipt);
  }, /second failed/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(receipts, [0]);
  assert.deepStrictEqual(unhandled, []);

  const aborted = AbortSignal.abort(new Error('stop'));
  await assert.rejects(async () => {
    for await (const receipt of sendConcurrently([0], 1, async (index) => index, aborted)) {
      assert.fail(receipt);
    }
  }, /stop/);
});

test('Internal: concurrency must be a positive integer', () => {
  const { checkConcurrency } = require('../../src/internal/config.js');
  for (const concurrency of [1, 8]) checkConcurrency(concurrency);
  for (const concurrency of [0, -1, 1.5, Infinity, '2', undefined]) {
    assert.throws(() => checkConcurrency(concurrency), RangeError, String(concurrency));
  }
});

test('Internal: every provider that took validateSsl refuses false', () => {
  const transports = [
    [
      require('../../src/ses/index.js').SesTransport,
      { authentication: { type: 'credentials', accessKeyId: 'A', secretAccessKey: 'S' } },
    ],
    [require('../../src/resend/index.js').ResendTransport, { apiKey: 're_key' }],
    [require('../../src/sendgrid/index.js').SendGridTransport, { apiKey: 'SG.key' }],
    [
      require('../../src/mailgun/index.js').MailgunTransport,
      { apiKey: 'key', domain: 'mg.example.com' },
    ],
    [require('../../src/mailtrap/index.js').MailtrapTransport, { token: 'token' }],
    [require('../../src/plunk/index.js').PlunkTransport, { apiKey: 'sk_key' }],
  ];
  for (const [Transport, config] of transports) {
    assert.throws(() => new Transport({ ...config, validateSsl: false }), /fetch checks every/);
    assert.ok(new Transport({ ...config, validateSsl: true }));
    assert.ok(new Transport(config));
  }
});

test('Config: a clock that is not a function is refused where a provider takes one', () => {
  // Before: azure, sendgrid, mailersend and smtp2go took any `now`, and
  // failed at the first send that read it.
  const { AzureTransport } = require('../../src/azure/index.js');
  const { MailerSendTransport } = require('../../src/mailersend/index.js');
  const { SendGridTransport } = require('../../src/sendgrid/index.js');
  const { Smtp2goTransport } = require('../../src/smtp2go/index.js');
  const key = Buffer.from('k').toString('base64');
  const makers = [
    () =>
      new AzureTransport({ endpoint: 'https://a.communication.azure.com', accessKey: key, now: 1 }),
    () => new MailerSendTransport({ apiKey: 'k', now: 1 }),
    () => new SendGridTransport({ apiKey: 'k', now: 1 }),
    () => new Smtp2goTransport({ apiKey: 'k', now: 1 }),
  ];
  for (const make of makers) assert.throws(make, /now must be a function/);
});

test('Decorators: pool and retry keep their loops to themselves', () => {
  const { PoolTransport } = require('../../src/pool/index.js');
  const { RetryTransport } = require('../../src/retry/index.js');
  const inner = { id: 'x', send: async () => ({ successful: true, messageId: 'm' }) };
  assert.strictEqual(
    'deliver' in new PoolTransport({ strategy: 'priority', transports: [{ transport: inner }] }),
    false,
  );
  assert.strictEqual('withRetries' in new RetryTransport(inner), false);
});

test('Internal: a timeout past what a timer keeps is a long one, not one of 1 ms', async (t) => {
  // Before: a timeout over 2^31 - 1 ms went to setTimeout as it was, which
  // fires such a delay at once, so every request of a provider with
  // timeout: 3e9 timed out, and AbortSignal.timeout past 2^32 - 1 threw.
  const { timerMs } = require('../../src/internal/sleep.js');
  assert.strictEqual(timerMs(1000), 1000);
  assert.strictEqual(timerMs(0), 0);
  assert.strictEqual(timerMs(3e9), 2_147_483_647);
  assert.strictEqual(timerMs(Number.POSITIVE_INFINITY), 2_147_483_647);
  const { createMessage } = require('../../index.js');
  const { PostmarkTransport } = require('../../src/postmark/index.js');
  t.mock.method(globalThis, 'fetch', async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return Response.json({ MessageID: 'pm-1', ErrorCode: 0 });
  });
  const postmark = new PostmarkTransport({ serverToken: 'token', timeout: 3e9, retries: 0 });
  const receipt = await postmark.send(
    createMessage({
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 's',
      content: { text: 'x' },
    }),
  );
  assert.strictEqual(receipt.successful, true, receipt.errorMessages?.join());
  const { TeeTransport } = require('../../src/tee/index.js');
  const { fakeTransport, sent } = require('../helpers/decorators/fake.js');
  const outcomes = [];
  const tee = new TeeTransport(fakeTransport(), {
    mirrors: [fakeTransport(async () => sent('m'))],
    timeout: 5e9,
    awaitMirrors: true,
    onMirror: (outcome) => outcomes.push(outcome.receipt?.successful ?? outcome.error?.message),
  });
  await tee.send(
    createMessage({
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 's',
      content: { text: 'x' },
    }),
  );
  assert.deepStrictEqual(outcomes, [true]);
});

test('Internal: a logger that throws is told once, by its name, not its text', (t) => {
  // Before: every record a broken logger threw on was a process warning, with
  // its error text as it was, such as the recipient it failed to write.
  const { createLog } = require('../../src/internal/log.js');
  const warnings = [];
  t.mock.method(process, 'emitWarning', (text, options) => warnings.push([options.code, text]));
  const log = createLog(
    {
      info: () => {
        throw new Error('cannot write bob@example.com');
      },
    },
    {},
  );
  for (let i = 0; i < 25; i++) log.write('info', {}, 'x');
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0][0], 'MAILER_LOGGER_FAILED');
  assert.match(warnings[0][1], /threw Error; its later failures are not told/);
  assert.doesNotMatch(warnings[0][1], /bob@example\.com/);
});
