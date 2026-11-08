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
const { isCallerAbort } = require('./abort.js');
const { certificateFailure, refusalFailure } = require('./refusal.js');
const { createLog } = require('./log.js');
const { isUnsentRequestError, markUnsent } = require('./unsent.js');

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

/**
 * The body of a request as it goes, and the Content-Type it needs unless the
 * caller gives one: FormData as it is (fetch writes its boundary); a form of
 * URLSearchParams as its text, `application/x-www-form-urlencoded` (Twilio,
 * Vonage, the Query API of AWS, an exchange of OAuth), so that a signature
 * reads what is sent; a string as it is, of the caller's type (the JSON of
 * `application/x-amz-json-1.0`); bytes as they are (a record of Web Push);
 * anything else as JSON.
 *
 * @internal
 */
const bodyOf = (body) => {
  if (body === undefined || body instanceof FormData || typeof body === 'string') return { body };
  if (body instanceof URLSearchParams) {
    return { body: body.toString(), type: 'application/x-www-form-urlencoded' };
  }
  if (body instanceof Uint8Array) return { body, type: 'application/octet-stream' };
  return { body: JSON.stringify(body), type: 'application/json' };
};

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

// The failure of a request before it was sent, as it waited for its token or
// credentials or as its header fields were made, of no unknown delivery. A
// header field `Headers` refused prints its value, a credential perhaps, so
// its error is one that does not.
const unsentOf = (provider, error) =>
  markUnsent(
    error instanceof TypeError && !isUnsentRequestError(error)
      ? new ProviderApiError(provider.id, `${provider.label}: a header field is no valid value.`, {
          category: 'configuration',
          retryable: false,
        })
      : error,
  );

/**
 * Makes the client of a provider's API.
 *
 * @param config The resolved configuration: `fetch`, `headers`, `retries`,
 * `timeout` and `logger`.
 * @param provider `id`, the provider's id; `label`, its name in messages;
 * `authorize(headers, { url, method, body, signal })`, which adds its
 * credentials, a token it waits for under the signal of the attempt; optional
 * `messageOf(json, text)`, the message of an error answer, and
 * `classify(status, json, headers)`, `{ category, retryable, code,
 * retryAfterMilliseconds }` of one, the wait of a body in place of
 * `Retry-After`.  A provider with errors of its own replaces any of:
 * `read(response, text, attempt)`, the result of a 2xx, which a request may
 * replace too; `reject(response, text, attempt)`, the error of another
 * answer, `text` undefined when it could not be read; `timeoutError()`;
 * `finalError(error, attempts)`; `acceptedError(error, attempts)`, a failure
 * after a 2xx; `isAnswer(error)`, a refusal in a 2xx; `isAmbiguousStatus(status)`,
 * an answer after which the request may have been taken, held as of unknown
 * delivery as a 504 is; `accepts(status)`, an
 * answer read as a 2xx is, which a request may replace; `retryDelayMs(attempt,
 * error)`; and `sleep(milliseconds, signal)` (see `requestWithRetry`).
 * @returns `{ log, fetchWithAuth, request }`.
 * @internal
 */
const createApiClient = (config, provider) => {
  const log = createLog(config.logger, { transport: provider.id });

  const fetchWithAuth = async (url, options, signal) => {
    let headers;
    try {
      headers = new Headers(options.headers);
      // The signal of the attempt, which a token the request waits for hears.
      await provider.authorize(headers, {
        url,
        method: options.method ?? 'GET',
        body: options.body,
        signal,
      });
      for (const name in config.headers) {
        if (Object.hasOwn(config.headers, name)) headers.set(name, config.headers[name]);
      }
    } catch (error) {
      throw unsentOf(provider, error);
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
    const classified = provider.classify?.(response.status, json, response.headers) ?? {};
    return new ProviderApiError(provider.id, `${provider.label}: ${message}`, {
      statusCode: response.status,
      // Some APIs tell the wait in their body (Telegram, Discord) rather than
      // in Retry-After.
      retryAfterMilliseconds:
        classified.retryAfterMilliseconds ?? parseRetryAfter(response.headers.get('Retry-After')),
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
   * 2xx, an empty body as `null`, or what the `read` of the request or of the
   * provider makes of it.  A 2xx whose body is not JSON fails as of unknown
   * delivery, as the provider may have taken the request, unless a `read`
   * takes it (a webhook of Slack answers `ok`).  The body goes as `bodyOf`
   * makes it, once for every attempt; the `Content-Type` and `Accept` of the
   * caller, in any case, are kept.
   */
  const request = (options) => {
    const headers = new Headers(options.headers);
    if (!headers.has('accept')) headers.set('Accept', 'application/json');
    const { body, type } = bodyOf(options.body);
    if (type !== undefined && !headers.has('content-type')) headers.set('Content-Type', type);
    const readAnswer = options.read ?? read;
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
      read: async (response, attempt) => readAnswer(response, await readText(response), attempt),
      reject: async (response, attempt) => reject(response, await readErrorText(response), attempt),
      // What the provider says of an error is retried as it says, a 420 of
      // SparkPost's spent limit among them; the status says the rest.
      isRetryable: retryableOf,
      createTimeoutError: timeoutError,
      finalError,
      wrapAccepted: provider.acceptedError,
      isAnswer: provider.isAnswer,
      isAmbiguousStatus: provider.isAmbiguousStatus,
      accepts: options.accepts ?? provider.accepts,
      retryDelayMs: provider.retryDelayMs,
      sleep: provider.sleep,
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

module.exports = {
  ProviderApiError,
  categoryOf,
  createApiClient,
  isCallerAbort,
  parseAnswer,
  providerFailure,
  truncateErrorText,
};
