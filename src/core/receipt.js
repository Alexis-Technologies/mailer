// Ported from upyo v0.7.0 (packages/core/src/receipt.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Classifies an HTTP status code for delivery error handling.
 *
 * @param statusCode The HTTP status code to classify.
 * @returns The receipt error category and retryability.
 */
const classifyHttpStatus = (statusCode) => {
  if (statusCode === 401 || statusCode === 403) {
    return { category: 'auth', retryable: false };
  }
  if (statusCode === 408 || statusCode === 504) {
    return { category: 'timeout', retryable: true };
  }
  if (statusCode === 429) {
    return { category: 'rate-limit', retryable: true };
  }
  if (statusCode === 503) {
    return { category: 'service-unavailable', retryable: true };
  }
  if (statusCode >= 400 && statusCode < 500) {
    return { category: 'validation', retryable: false };
  }
  if (statusCode >= 500 && statusCode < 600) {
    return { category: 'server-error', retryable: true };
  }
  return { category: 'unknown', retryable: false };
};

// System and undici codes of a failure without a response.
const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_SOCKET',
]);

// Status codes in a message count as whole numbers only: "4013 octets" holds
// no 401, nor "5000 ms" a 500.
const hasNumber = (text, pattern) => pattern.test(text);
const AUTH_STATUS = /\b(?:401|403)\b/;
const RATE_LIMIT_STATUS = /\b429\b/;
const VALIDATION_STATUS = /\b(?:400|422)\b/;
const UNAVAILABLE_STATUS = /\b503\b/;
const SERVER_ERROR_STATUS = /\b(?:500|502)\b/;

// The first `code` along the chain of causes, as `fetch failed` keeps the
// socket error behind it.
const findErrorCode = (error) => {
  let current = error;
  for (let depth = 0; depth < 4 && current != null && typeof current === 'object'; depth++) {
    if (typeof current.code === 'string') return current.code;
    current = current.cause;
  }
  return undefined;
};

/**
 * Classifies a failure: by the HTTP status it carries, then by the system
 * code along its causes, and only then by the words of its message.
 *
 * @param error The error to classify.
 * @returns The category, retryability and default code.
 */
const classifyReceiptError = (error) => {
  const statusCode = error != null && typeof error === 'object' ? error.statusCode : undefined;
  if (Number.isInteger(statusCode)) {
    return { ...classifyHttpStatus(statusCode), code: `http.${statusCode}` };
  }
  const errorCode = findErrorCode(error);
  if (TIMEOUT_CODES.has(errorCode)) {
    return { category: 'timeout', retryable: true, code: 'timeout' };
  }
  if (NETWORK_CODES.has(errorCode)) {
    return { category: 'network', retryable: true, code: 'network' };
  }
  // A certificate refused during the TLS handshake will not pass on a retry.
  if (typeof errorCode === 'string' && errorCode.includes('CERT')) {
    return { category: 'configuration', retryable: false, code: 'configuration' };
  }

  const message = getStringProperty(error, 'message') ?? String(error);
  const name = getStringProperty(error, 'name') ?? '';
  const text = `${name} ${message}`.toLowerCase();

  if (text.includes('timeout') || text.includes('timed out')) {
    return { category: 'timeout', retryable: true, code: 'timeout' };
  }
  if (
    text.includes('network') ||
    text.includes('connect') ||
    text.includes('fetch failed') ||
    text.includes('dns') ||
    text.includes('econnreset') ||
    text.includes('econnrefused') ||
    text.includes('enotfound') ||
    name === 'NetworkError'
  ) {
    return { category: 'network', retryable: true, code: 'network' };
  }
  if (
    text.includes('authentication') ||
    text.includes('authenticate') ||
    text.includes('authorization') ||
    text.includes('authorize') ||
    /\bauth\b/.test(text) ||
    text.includes('unauthorized') ||
    text.includes('not authorized') ||
    text.includes('forbidden') ||
    text.includes('invalid api key') ||
    text.includes('invalid token') ||
    hasNumber(text, AUTH_STATUS)
  ) {
    return { category: 'auth', retryable: false, code: 'auth' };
  }
  if (
    text.includes('rate limit') ||
    text.includes('rate-limit') ||
    text.includes('too many requests') ||
    text.includes('quota') ||
    text.includes('throttle') ||
    hasNumber(text, RATE_LIMIT_STATUS)
  ) {
    return {
      category: 'rate-limit',
      retryable: true,
      code: 'rate-limit',
    };
  }
  if (
    text.includes('invalid') ||
    text.includes('malformed') ||
    text.includes('validation') ||
    text.includes('bad request') ||
    hasNumber(text, VALIDATION_STATUS)
  ) {
    return { category: 'validation', retryable: false, code: 'validation' };
  }
  if (
    text.includes('rejected') ||
    text.includes('bounce') ||
    text.includes('complaint') ||
    text.includes('suppressed') ||
    text.includes('unsubscribed')
  ) {
    return { category: 'rejected', retryable: false, code: 'rejected' };
  }
  if (
    text.includes('service unavailable') ||
    text.includes('temporarily unavailable') ||
    hasNumber(text, UNAVAILABLE_STATUS)
  ) {
    return {
      category: 'service-unavailable',
      retryable: true,
      code: 'service-unavailable',
    };
  }
  if (
    text.includes('internal server error') ||
    text.includes('bad gateway') ||
    hasNumber(text, SERVER_ERROR_STATUS)
  ) {
    return {
      category: 'server-error',
      retryable: true,
      code: 'server-error',
    };
  }
  if (text.includes('config') || text.includes('unsupported')) {
    return {
      category: 'configuration',
      retryable: false,
      code: 'configuration',
    };
  }
  return { category: 'unknown', retryable: false, code: 'unknown' };
};

/**
 * Creates structured information about a delivery failure.
 *
 * @param message Human-readable error message.
 * @param options Optional structured error metadata.
 * @returns A structured receipt error.
 */
const createReceiptError = (message, options = {}) => {
  const classification =
    options.statusCode == null
      ? classifyReceiptError(message)
      : classifyHttpStatus(options.statusCode);
  const category = options.category ?? classification.category;
  const retryable = options.retryable ?? classification.retryable;
  const code =
    options.code ??
    (options.statusCode == null
      ? options.category != null
        ? category
        : (classification.code ?? category)
      : `http.${options.statusCode}`);

  return omitUndefined({
    message,
    category,
    code,
    retryable,
    provider: options.provider,
    statusCode: options.statusCode,
    retryAfterMilliseconds: options.retryAfterMilliseconds,
    providerDetails: options.providerDetails,
  });
};

/**
 * Creates a failed receipt with human-readable and structured errors.
 *
 * @param error Error message, structured error, or list of structured errors.
 * @param options Optional receipt and error metadata.
 * @returns A failed receipt.
 */
const createFailedReceipt = (error, options = {}) => {
  // When delivery is unknown, the message may have been accepted, so sending
  // it again may deliver it twice: neither the receipt nor the errors made for
  // it are retryable, whatever their classification says.
  const deliveryUnknown = options.deliveryUnknown === true ? true : undefined;
  const errorOptions = deliveryUnknown === true ? { ...options, retryable: false } : options;
  const errors =
    options.errors ??
    (typeof error === 'string'
      ? [createReceiptError(error, errorOptions)]
      : Array.isArray(error)
        ? error.map((item) =>
            typeof item === 'string' ? createReceiptError(item, errorOptions) : item,
          )
        : [error]);
  const errorMessages =
    typeof error === 'string'
      ? [error]
      : Array.isArray(error)
        ? error.map((item) => (typeof item === 'string' ? item : item.message))
        : errors.map((receiptError) => receiptError.message);
  const retryable =
    deliveryUnknown === true
      ? false
      : (options.retryable ?? errors.some((receiptError) => receiptError.retryable));
  const provider = options.provider ?? errors[0]?.provider;

  return omitUndefined({
    successful: false,
    errorMessages,
    errors,
    retryable,
    deliveryUnknown,
    provider,
    attempts: options.attempts,
    timestamp: options.timestamp ?? new Date().toISOString(),
  });
};

/**
 * Parses an HTTP `Retry-After` header value into milliseconds.
 *
 * A delay longer than a day is read as a day: no sender waits longer within a
 * send, and a value such as `99999999999` would otherwise mean centuries.
 *
 * @param value Header value to parse.
 * @param now Current time used when parsing HTTP dates.
 * @returns Retry delay in milliseconds, or `undefined` if invalid.
 */
const parseRetryAfter = (value, now = new Date()) => {
  if (value == null || value.trim() === '') return undefined;

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, MAX_RETRY_AFTER_MS);
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return undefined;

  const delayMs = timestamp - now.getTime();
  return delayMs > 0 ? Math.min(delayMs, MAX_RETRY_AFTER_MS) : undefined;
};

const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

const getStringProperty = (value, property) => {
  if (value instanceof Error) {
    return value[property];
  }
  if (typeof value !== 'object' || value == null || !(property in value)) {
    return undefined;
  }
  const propertyValue = value[property];
  return propertyValue == null ? undefined : String(propertyValue);
};

// Copies the defined fields of an object literal in one pass, without the
// entry arrays of Object.entries and Object.fromEntries.
const omitUndefined = (value) => {
  const result = {};
  for (const key in value) {
    if (value[key] !== undefined) result[key] = value[key];
  }
  return result;
};

module.exports = {
  classifyHttpStatus,
  classifyReceiptError,
  createReceiptError,
  createFailedReceipt,
  parseRetryAfter,
};
