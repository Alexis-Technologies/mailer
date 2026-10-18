// Not ported: the client of a provider's API that every HTTP provider uses,
// those of 1.1 with its defaults, those ported from upyo with their own errors
// and messages through its hooks: the error of their API, an authenticated
// request through `requestWithRetry`, and the receipt of a failure.

const {
  classifyReceiptError,
  createFailedReceipt,
  parseRetryAfter,
} = require('../core/receipt.js');
const { readText } = require('./body.js');
const { isDeliveryUnknown } = require('./delivery-unknown.js');
const { isRetryableFailure, requestWithRetry } = require('./http.js');
const { certificateFailure, refusalFailure } = require('./refusal.js');
const { createLog } = require('./log.js');

const MAX_ERROR_TEXT = 500;

/**
 * An error of a provider's API: its status, its own code and the category the
 * provider gives it, the wait it asks for, and the attempts made.  The public
 * errors of the providers ported from upyo (`SendGridApiError`…) extend it.
 *
 * @internal
 */
class ProviderApiError extends Error {
  constructor(provider, message, details = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'ProviderApiError';
    this.provider = provider;
    this.statusCode = details.statusCode;
    this.retryAfterMilliseconds = details.retryAfterMilliseconds;
    this.attempts = details.attempts;
    this.category = details.category;
    this.retryable = details.retryable;
    this.providerDetails = details.providerDetails;
    // The code of the receipt, apart from `code`, which classifyReceiptError
    // reads as a system error code.
    this.receiptCode = details.code;
  }
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const shorten = (text) =>
  text.length > MAX_ERROR_TEXT ? `${text.slice(0, MAX_ERROR_TEXT)}…` : text;

// The message an API gives for an error, in the fields most of them use.
const defaultMessageOf = (json) => {
  if (json == null || typeof json !== 'object') return undefined;
  if (typeof json.message === 'string') return json.message;
  if (typeof json.Message === 'string') return json.Message;
  if (typeof json.error === 'string') return json.error;
  if (typeof json.error?.message === 'string') return json.error.message;
  const first = Array.isArray(json.errors) ? json.errors[0] : undefined;
  if (typeof first === 'string') return first;
  if (typeof first?.message === 'string') return first.message;
  return undefined;
};

// The answer of a 2xx: its JSON, an empty body as null.
const defaultRead = (provider) => (response, text) => {
  const json = text.trim() === '' ? null : parseJson(text);
  if (json === undefined) {
    throw new ProviderApiError(provider.id, `${provider.label} answered with no JSON.`, {
      statusCode: response.status,
    });
  }
  return { status: response.status, headers: response.headers, json };
};

const defaultTimeoutError = (config, provider) => () =>
  new ProviderApiError(
    provider.id,
    `${provider.label} API request timed out after ${config.timeout} ms.`,
  );

const defaultFinalError = (provider) => (error, attempts) =>
  error instanceof ProviderApiError
    ? error
    : new ProviderApiError(provider.id, `${provider.label}: ${error.message}`, {
        attempts,
        cause: error,
      });

const retryableOf = (error) =>
  typeof error.retryable === 'boolean' ? error.retryable : isRetryableFailure(error);

// The text of an error answer, or undefined when it cannot be read: the
// error then keeps the status, which says more than the failure to read.
const readErrorText = async (response) => {
  try {
    return await readText(response);
  } catch {
    return undefined;
  }
};

/**
 * Makes the client of a provider's API.
 *
 * @param config The resolved configuration: `fetch`, `headers`, `retries`,
 * `timeout` and `logger`.
 * @param provider `id`, the provider's id; `label`, its name in messages;
 * `authorize(headers, request)`, which adds its credentials; optional
 * `messageOf(json, text)`, the message of an error answer, and
 * `classify(status, json)`, `{ category, retryable, code }` of one.  A
 * provider with errors of its own replaces any of: `read(response, text,
 * attempt)`, the result of a 2xx; `reject(response, text, attempt)`, the
 * error of another answer, `text` undefined when it could not be read;
 * `timeoutError()`; `finalError(error, attempts)`; `acceptedError(error,
 * attempts)`, a failure after a 2xx; and `isAnswer(error)`, a refusal in a
 * 2xx (see `requestWithRetry`).
 * @returns `{ log, fetchWithAuth, request }`.
 * @internal
 */
const createApiClient = (config, provider) => {
  const log = createLog(config.logger, { transport: provider.id });

  const fetchWithAuth = async (url, options, signal) => {
    const headers = new Headers(options.headers);
    await provider.authorize(headers, { url, method: options.method ?? 'GET', body: options.body });
    for (const name in config.headers) {
      if (Object.hasOwn(config.headers, name)) headers.set(name, config.headers[name]);
    }
    // A redirect comes back as a response rather than being followed, so the
    // credentials in the headers never reach another origin.
    const fetch = config.fetch ?? globalThis.fetch;
    return fetch(url, { ...options, headers, signal, redirect: 'manual' });
  };

  const rejectionOf = (response, read, attempt) => {
    const text = read ?? '';
    const json = parseJson(text);
    const message =
      (provider.messageOf ?? defaultMessageOf)(json, text) ??
      (text.trim() === '' ? `HTTP ${response.status}` : shorten(text.trim()));
    const classified = provider.classify?.(response.status, json) ?? {};
    return new ProviderApiError(provider.id, `${provider.label}: ${message}`, {
      statusCode: response.status,
      retryAfterMilliseconds: parseRetryAfter(response.headers.get('Retry-After')),
      attempts: attempt + 1,
      category: classified.category,
      retryable: classified.retryable,
      code: classified.code,
      providerDetails: json ?? undefined,
    });
  };

  const timeoutError = provider.timeoutError ?? defaultTimeoutError(config, provider);
  const finalError = provider.finalError ?? defaultFinalError(provider);
  const read = provider.read ?? defaultRead(provider);
  const reject = provider.reject ?? rejectionOf;

  /**
   * Sends one request and reads its answer: `{ status, headers, json }` of a
   * 2xx, an empty body as `null`, or what the provider's `read` makes of it.
   * A 2xx whose body is not JSON fails as of unknown delivery, as the
   * provider may have taken the request.  A body of FormData goes as it is,
   * any other as JSON, serialized once for every attempt.
   */
  const request = (options) => {
    const isForm = options.body instanceof FormData;
    const headers = { Accept: 'application/json', ...options.headers };
    let body;
    if (isForm) body = options.body;
    else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    return requestWithRetry({
      log,
      signal: options.signal,
      onRetry: options.onRetry,
      retries: config.retries,
      timeoutMs: config.timeout,
      hasIdempotencyKey: options.hasIdempotencyKey === true,
      isIdempotent: options.isIdempotent === true,
      send: (signal) =>
        fetchWithAuth(options.url, { method: options.method ?? 'POST', headers, body }, signal),
      read: async (response, attempt) => read(response, await readText(response), attempt),
      reject: async (response, attempt) => reject(response, await readErrorText(response), attempt),
      // What the provider says of an error is retried as it says, a 420 of
      // SparkPost's spent limit among them; the status says the rest.
      isRetryable: retryableOf,
      createTimeoutError: timeoutError,
      finalError,
      wrapAccepted: provider.acceptedError,
      isAnswer: provider.isAnswer,
    });
  };

  return { log, fetchWithAuth, request };
};

/**
 * The receipt of a failure, with what the error says of it.
 *
 * @param provider The provider's id.
 * @param error What was thrown.
 * @returns A failed receipt.
 * @internal
 */
const providerFailure = (provider, error) => {
  const message = error instanceof Error ? error.message : String(error);
  const certificate = certificateFailure(provider, message, error);
  if (certificate !== undefined) return certificate;
  if (error instanceof ProviderApiError) {
    return createFailedReceipt(message, {
      provider,
      deliveryUnknown: isDeliveryUnknown(error),
      statusCode: error.statusCode,
      retryAfterMilliseconds: error.retryAfterMilliseconds,
      attempts: error.attempts,
      category: error.category,
      retryable: error.retryable,
      code: error.receiptCode,
      providerDetails: error.providerDetails,
    });
  }
  return (
    refusalFailure(provider, error) ??
    createFailedReceipt(message, {
      provider,
      deliveryUnknown: isDeliveryUnknown(error),
      attempts: typeof error?.attempts === 'number' ? error.attempts : undefined,
      // By the codes along its causes first, then by its words.
      ...categoryOf(error),
    })
  );
};

/**
 * The category and retryability of a thrown error, by `classifyReceiptError`.
 *
 * @internal
 */
const categoryOf = (error) => {
  const { category, retryable } = classifyReceiptError(error);
  return { category, retryable };
};

/**
 * Parses the JSON of a 2xx, or throws what `invalid(error)` makes of a body
 * that is not JSON.
 *
 * @internal
 */
const parseAnswer = (text, invalid) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw invalid(error);
  }
};

/**
 * Cuts the text of an error answer to 500 characters, as the providers
 * ported from upyo do, with `...` after it.
 *
 * @internal
 */
const truncateErrorText = (text) =>
  text.length > MAX_ERROR_TEXT ? `${text.slice(0, MAX_ERROR_TEXT)}...` : text;

/**
 * Whether an error is the abort of the caller's own signal.
 *
 * @internal
 */
const isCallerAbort = (error, signal) =>
  signal?.aborted === true && (error === signal.reason || error?.name === 'AbortError');

module.exports = {
  ProviderApiError,
  categoryOf,
  createApiClient,
  isCallerAbort,
  parseAnswer,
  providerFailure,
  truncateErrorText,
};
