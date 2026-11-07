// Not ported: tells a request that never left from one that may
// have reached the server, for a request that must not be sent twice.

const { isCertificateFailure } = require('../core/receipt.js');

// System error codes of a connection that was never made, so no request went
// out: a refused connection, an unknown or unreachable host.
const UNSENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

// The failures marked as of a request that never left, by what made them:
// the token a request waits for, which failed before it was sent.
const UNSENT = new WeakSet();

/**
 * Marks a failure as of a request that was never sent, such as the failure to
 * get the token it was to carry.
 *
 * @param error The failure.
 * @returns The failure.
 * @internal
 */
const markUnsent = (error) => {
  if (error !== null && typeof error === 'object') UNSENT.add(error);
  return error;
};

/**
 * Whether a failed request certainly never reached the server: somewhere in
 * its chain of causes is the code of a connection that was never made, as
 * `fetch` reports it (`TypeError: fetch failed`, caused by the socket error),
 * a failure marked by `markUnsent`, or a certificate refused in the TLS
 * handshake, which ends the connection before any request.
 * Any other failure without a response, such as a timeout or a reset, may
 * have come after the server received the request.
 *
 * @param error The failure of the request.
 * @returns `true` when the request was never sent.
 * @internal
 */
const isUnsentRequestError = (error) => {
  if (isCertificateFailure(error)) return true;
  let current = error;
  for (let depth = 0; depth < 4 && current != null; depth++) {
    if (UNSENT_CODES.has(current.code) || UNSENT.has(current)) return true;
    current = current.cause;
  }
  return false;
};

module.exports = { isUnsentRequestError, markUnsent };
