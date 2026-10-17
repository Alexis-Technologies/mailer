// Not ported: the checks of the options that every HTTP provider
// shares, made once, when its configuration is made.

const { isLoopbackHost } = require('./loopback.js');

/**
 * Checks the timeout and the retries of a provider's configuration.
 *
 * @param timeoutMs The timeout of an attempt in milliseconds, 0 or `Infinity`
 * for none.
 * @param retries How many times a failed attempt is retried.
 * @throws {RangeError} If either is not a number of that kind.
 * @internal
 */
const checkRequestOptions = (timeoutMs, retries) => {
  if (typeof timeoutMs !== 'number' || !(timeoutMs >= 0)) {
    throw new RangeError(
      '`timeout` must be a number of milliseconds, 0 or Infinity for none: ' + String(timeoutMs),
    );
  }
  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError('`retries` must be a non-negative integer: ' + String(retries));
  }
};

/**
 * Checks that a URL of a provider's configuration keeps credentials off the
 * network in clear: HTTPS, or plain HTTP only to a loopback host.
 *
 * @param value The URL, as configured.
 * @param name The option it comes from, for the error.
 * @throws {TypeError} If it is not a URL, or neither HTTPS nor loopback HTTP.
 * @internal
 */
const checkSecureUrl = (value, name) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`\`${name}\` must be a URL: ${String(value)}`);
  }
  if (url.protocol === 'https:') return;
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return;
  throw new TypeError(
    `\`${name}\` must use HTTPS, or plain HTTP only to a loopback host, ` +
      `so that credentials are not sent in clear: ${value}`,
  );
};

/**
 * Checks how many messages a sendMany() of a provider sends at once.
 *
 * @param concurrency The most sends at once.
 * @throws {RangeError} If it is not a positive integer.
 * @internal
 */
const checkConcurrency = (concurrency) => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('`concurrency` must be a positive integer: ' + String(concurrency));
  }
};

module.exports = { checkConcurrency, checkRequestOptions, checkSecureUrl };
