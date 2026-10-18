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

// The categories the words of a message point to, tried in this order: a
// message that names both a timeout and a host is a timeout.  Status codes in
// a message count as whole numbers only: "4013 octets" holds no 401, nor
// "5000 ms" a 500.
const WORD_RULES = [
  { category: 'timeout', retryable: true, words: ['timeout', 'timed out'] },
  {
    category: 'network',
    retryable: true,
    words: ['network', 'connect', 'fetch failed', 'dns', 'econnreset', 'econnrefused', 'enotfound'],
    name: 'NetworkError',
  },
  {
    category: 'auth',
    retryable: false,
    words: [
      'authentication',
      'authenticate',
      'authorization',
      'authorize',
      'unauthorized',
      'not authorized',
      'forbidden',
      'invalid api key',
      'invalid token',
    ],
    pattern: /\bauth\b|\b(?:401|403)\b/,
  },
  {
    category: 'rate-limit',
    retryable: true,
    words: ['rate limit', 'rate-limit', 'too many requests', 'quota', 'throttle'],
    pattern: /\b429\b/,
  },
  {
    category: 'validation',
    retryable: false,
    words: ['invalid', 'malformed', 'validation', 'bad request'],
    pattern: /\b(?:400|422)\b/,
  },
  {
    category: 'rejected',
    retryable: false,
    words: ['rejected', 'bounce', 'complaint', 'suppressed', 'unsubscribed'],
  },
  {
    category: 'service-unavailable',
    retryable: true,
    words: ['service unavailable', 'temporarily unavailable'],
    pattern: /\b503\b/,
  },
  {
    category: 'server-error',
    retryable: true,
    words: ['internal server error', 'bad gateway'],
    pattern: /\b(?:500|502)\b/,
  },
  { category: 'configuration', retryable: false, words: ['config', 'unsupported'] },
];

const matchesWordRule = (rule, text, name) => {
  for (const word of rule.words) {
    if (text.includes(word)) return true;
  }
  if (rule.pattern !== undefined && rule.pattern.test(text)) return true;
  return rule.name !== undefined && rule.name === name;
};

// A certificate refused during the TLS handshake: the verification errors of
// OpenSSL that name one (CERT_HAS_EXPIRED, DEPTH_ZERO_SELF_SIGNED_CERT), Node's
// ERR_TLS_CERT_ALTNAME_INVALID, and the leaf of an unknown issuer, which names
// none and is the one Node and Bun report for a CA they do not know.
const isCertificateCode = (code) =>
  typeof code === 'string' && (code.includes('CERT') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');

// Deno's fetch, on rustls, gives a refused certificate no code, only the text
// of its cause: "… client error (Connect): invalid peer certificate: …".
const CERTIFICATE_TEXT = /\binvalid peer certificate\b/i;

/**
 * Whether a failure is a TLS certificate refused in the handshake: by the code
 * along its causes on Node and Bun, by their text on Deno.  No retry passes
 * it, and no request went out.
 *
 * @param error The failure.
 * @returns `true` for a refused certificate.
 * @internal
 */
const isCertificateFailure = (error) => {
  let current = error;
  for (let depth = 0; depth < 4 && current != null && typeof current === 'object'; depth++) {
    if (isCertificateCode(current.code)) return true;
    if (typeof current.message === 'string' && CERTIFICATE_TEXT.test(current.message)) {
      return true;
    }
    current = current.cause;
  }
  return false;
};

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
  if (isCertificateFailure(error)) {
    return { category: 'configuration', retryable: false, code: 'configuration' };
  }

  const message = getStringProperty(error, 'message') ?? String(error);
  const name = getStringProperty(error, 'name') ?? '';
  const text = `${name} ${message}`.toLowerCase();
  for (const rule of WORD_RULES) {
    if (matchesWordRule(rule, text, name)) {
      return { category: rule.category, retryable: rule.retryable, code: rule.category };
    }
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
  let code = options.code;
  if (code == null) {
    if (options.statusCode != null) code = `http.${options.statusCode}`;
    else if (options.category != null) code = category;
    else code = classification.code ?? category;
  }

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
 * Gives the structured errors of a failure and its messages, in one pass over
 * a list that mixes strings and structured errors.
 *
 * @param error A message, a structured error, or a list of either.
 * @param given Structured errors given in place of those of `error`.
 * @param errorOptions The options of the errors made from strings.
 * @returns The structured errors and the messages.
 */
const describeFailure = (error, given, errorOptions) => {
  if (typeof error === 'string') {
    return { errors: given ?? [createReceiptError(error, errorOptions)], errorMessages: [error] };
  }
  if (!Array.isArray(error)) {
    const errors = given ?? [error];
    const errorMessages = [];
    for (const receiptError of errors) errorMessages.push(receiptError.message);
    return { errors, errorMessages };
  }
  const built = [];
  const errorMessages = [];
  for (const item of error) {
    const isText = typeof item === 'string';
    errorMessages.push(isText ? item : item.message);
    if (given == null) built.push(isText ? createReceiptError(item, errorOptions) : item);
  }
  return { errors: given ?? built, errorMessages };
};

const isAnyRetryable = (errors) => {
  for (const receiptError of errors) {
    if (receiptError.retryable) return true;
  }
  return false;
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
  const { errors, errorMessages } = describeFailure(error, options.errors, errorOptions);
  const retryable =
    deliveryUnknown === true ? false : (options.retryable ?? isAnyRetryable(errors));
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
  isCertificateFailure,
  parseRetryAfter,
};
