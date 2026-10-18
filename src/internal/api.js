// Not ported: what the HTTP providers added in 1.1 share, once rather than a
// copy in each: the error of their API, an authenticated JSON request through
// `requestWithRetry`, the receipt of a failure, and the conversion of a batch
// in which a message that cannot be converted fails alone.

const { readAttachmentContent } = require('../core/attachment.js');
const { createFailedReceipt, parseRetryAfter } = require('../core/receipt.js');
const { toBase64 } = require('./base64.js');
const { readText } = require('./body.js');
const { canonicalHeaderName } = require('./headers.js');
const { convertAttachments, visitCustomHeaders, withCalendarAttachment } = require('./provider.js');
const { isDeliveryUnknown } = require('./delivery-unknown.js');
const { requestWithRetry } = require('./http.js');
const { certificateFailure, refusalFailure } = require('./refusal.js');
const { createLog } = require('./log.js');

const MAX_ERROR_TEXT = 500;

/**
 * An error of a provider's API: its status, its own code and the category the
 * provider gives it, the wait it asks for, and the attempts made.
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

/**
 * Makes the client of a provider's API.
 *
 * @param config The resolved configuration: `fetch`, `headers`, `retries`,
 * `timeout` and `logger`.
 * @param provider `id`, the provider's id; `label`, its name in messages;
 * `authorize(headers, request)`, which adds its credentials; optional
 * `messageOf(json, text)`, the message of an error answer, and
 * `classify(status, json)`, `{ category, retryable, code }` of one.
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

  const rejectionOf = (response, text, attempt) => {
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

  /**
   * Sends one request and reads its answer: `{ status, headers, json }` of a
   * 2xx, an empty body as `null`.  A 2xx whose body is not JSON fails as of
   * unknown delivery, as the provider may have taken the request.
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
      read: async (response) => {
        const text = await readText(response);
        const json = text.trim() === '' ? null : parseJson(text);
        if (json === undefined) {
          throw new ProviderApiError(provider.id, `${provider.label} answered with no JSON.`, {
            statusCode: response.status,
          });
        }
        return { status: response.status, headers: response.headers, json };
      },
      reject: async (response, attempt) => rejectionOf(response, await readText(response), attempt),
      createTimeoutError: () =>
        new ProviderApiError(
          provider.id,
          `${provider.label} API request timed out after ${config.timeout} ms.`,
        ),
      finalError: (error, attempts) =>
        error instanceof ProviderApiError
          ? error
          : new ProviderApiError(provider.id, `${provider.label}: ${error.message}`, {
              attempts,
              cause: error,
            }),
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
    createFailedReceipt(message, { provider, deliveryUnknown: isDeliveryUnknown(error) })
  );
};

/**
 * Whether an error is the abort of the caller's own signal.
 *
 * @internal
 */
const isCallerAbort = (error, signal) =>
  signal?.aborted === true && (error === signal.reason || error?.name === 'AbortError');

/**
 * Converts each message of a batch, one that fails to convert failing alone.
 *
 * @param messages The messages.
 * @param convert Converts one message.
 * @param provider The provider's id, for the receipt of a failure.
 * @param signal Rethrows the caller's abort.
 * @returns `{ payloads, slots }`: a slot is the index of a payload, or the
 * receipt of a message that did not convert.
 * @internal
 */
const convertBatch = async (messages, convert, provider, signal) => {
  const payloads = [];
  const slots = [];
  for (let i = 0; i < messages.length; i++) {
    try {
      payloads.push(await convert(messages[i]));
      slots.push(payloads.length - 1);
    } catch (error) {
      if (isCallerAbort(error, signal)) throw error;
      slots.push(providerFailure(provider, error));
    }
  }
  return { payloads, slots };
};

/**
 * The receipts of a batch in the order of its messages: those of
 * `receiptOf(index)` for the payloads that were sent, and the failures of the
 * others.
 *
 * @internal
 */
const mergeBatch = function* (slots, receiptOf) {
  for (let i = 0; i < slots.length; i++) {
    yield typeof slots[i] === 'number' ? receiptOf(slots[i]) : slots[i];
  }
};

/**
 * Checks the credential a provider needs when the transport is made.
 *
 * @internal
 */
const checkCredential = (value, name, label) => {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`${label} needs ${name}.`);
  }
  return value;
};

/**
 * The attachments of a message, an iCalendar part among them, each with its
 * content in base64, read concurrently.
 *
 * @param message The message.
 * @param signal Cancels the reads.
 * @returns `{ attachment, content }` of each.
 * @internal
 */
const base64Attachments = (message, signal) =>
  convertAttachments(
    withCalendarAttachment(message),
    async (attachment, readSignal) => ({
      attachment,
      content: toBase64(await readAttachmentContent(attachment.content, readSignal)),
    }),
    signal,
  );

// The fields an API sets from its own parameters.
const STANDARD_HEADERS = new Set([
  'from',
  'to',
  'cc',
  'bcc',
  'reply-to',
  'subject',
  'content-type',
  'content-transfer-encoding',
  'mime-version',
]);
const isStandardHeader = (name) => STANDARD_HEADERS.has(name.toLowerCase());

const PRIORITY_HEADERS = {
  high: [
    ['X-Priority', '1'],
    ['X-MSMail-Priority', 'High'],
    ['Importance', 'High'],
  ],
  low: [
    ['X-Priority', '5'],
    ['X-MSMail-Priority', 'Low'],
    ['Importance', 'Low'],
  ],
};

/**
 * The header fields a provider is given besides those it sets itself: the
 * priority, the custom fields (List-* among them) and the threading fields,
 * names capitalized.
 *
 * @param message The message.
 * @returns `{ name, value }` of each.
 * @internal
 */
const headerFieldsOf = (message) => {
  const fields = [];
  const priority = PRIORITY_HEADERS[message.priority];
  if (priority !== undefined) {
    for (let i = 0; i < priority.length; i++) {
      fields.push({ name: priority[i][0], value: priority[i][1] });
    }
  }
  visitCustomHeaders(message, isStandardHeader, (name, value) => {
    fields.push({ name: canonicalHeaderName(name.toLowerCase()), value });
  });
  return fields;
};

/**
 * Sends one message of a provider: `convert(message, signal)`, then
 * `request(payload, options)`, then `receiptOf(answer)`.  The caller's abort
 * is thrown; any other failure is the receipt of `failureOf(error)`, the
 * provider's by default.
 *
 * @internal
 */
const sendConverted = async (message, options, steps) => {
  const signal = options?.signal;
  signal?.throwIfAborted();
  try {
    const payload = await steps.convert(message, signal);
    signal?.throwIfAborted();
    return steps.receiptOf(await steps.request(payload, options));
  } catch (error) {
    if (isCallerAbort(error, signal)) throw error;
    return steps.failureOf === undefined
      ? providerFailure(steps.provider, error)
      : steps.failureOf(error);
  }
};

/**
 * The receipt of an answer that should name the message: a success with its
 * id, or, without one, a failure of unknown delivery, as the provider took
 * the request.
 *
 * @internal
 */
const sentWith = (provider, messageId, missing) =>
  typeof messageId === 'string' && messageId !== ''
    ? { successful: true, messageId, provider }
    : createFailedReceipt(missing, { provider, deliveryUnknown: true });

module.exports = {
  ProviderApiError,
  base64Attachments,
  checkCredential,
  convertBatch,
  createApiClient,
  headerFieldsOf,
  isCallerAbort,
  mergeBatch,
  providerFailure,
  sendConverted,
  sentWith,
};
