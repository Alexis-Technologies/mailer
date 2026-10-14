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

/**
 * Classifies an arbitrary delivery failure.
 *
 * @param error The error to classify.
 * @returns The receipt error category, retryability, and default code.
 */
const classifyReceiptError = (error) => {
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
    text.includes('401') ||
    text.includes('403')
  ) {
    return { category: 'auth', retryable: false, code: 'auth' };
  }
  if (
    text.includes('rate limit') ||
    text.includes('rate-limit') ||
    text.includes('too many requests') ||
    text.includes('quota') ||
    text.includes('throttle') ||
    text.includes('429')
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
    text.includes('400') ||
    text.includes('422')
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
    text.includes('503')
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
    text.includes('500') ||
    text.includes('502')
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
  const errors =
    options.errors ??
    (typeof error === 'string'
      ? [createReceiptError(error, options)]
      : Array.isArray(error)
        ? error.map((item) => (typeof item === 'string' ? createReceiptError(item, options) : item))
        : [error]);
  const errorMessages =
    typeof error === 'string'
      ? [error]
      : Array.isArray(error)
        ? error.map((item) => (typeof item === 'string' ? item : item.message))
        : errors.map((receiptError) => receiptError.message);
  const retryable = options.retryable ?? errors.some((receiptError) => receiptError.retryable);
  const provider = options.provider ?? errors[0]?.provider;

  return omitUndefined({
    successful: false,
    errorMessages,
    errors,
    retryable,
    provider,
    attempts: options.attempts,
    timestamp: options.timestamp ?? new Date().toISOString(),
  });
};

/**
 * Parses an HTTP `Retry-After` header value into milliseconds.
 *
 * @param value Header value to parse.
 * @param now Current time used when parsing HTTP dates.
 * @returns Retry delay in milliseconds, or `undefined` if invalid.
 */
const parseRetryAfter = (value, now = new Date()) => {
  if (value == null || value.trim() === '') return undefined;

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const delay = Number(trimmed) * 1000;
    return delay;
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return undefined;

  const delay = timestamp - now.getTime();
  return delay > 0 ? delay : undefined;
};

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

const omitUndefined = (value) => {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
};

module.exports = {
  classifyHttpStatus,
  classifyReceiptError,
  createReceiptError,
  createFailedReceipt,
  parseRetryAfter,
};
