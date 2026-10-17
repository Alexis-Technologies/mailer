// Not ported from upyo: tells a request that never left from one that may
// have reached the server, for a request that must not be sent twice.

// System error codes of a connection that was never made, so no request went
// out: a refused connection, an unknown or unreachable host.  A certificate
// rejected during the TLS handshake also ends the connection before it.
const UNSENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

const isUnsentCode = (code) =>
  typeof code === 'string' && (UNSENT_CODES.has(code) || code.includes('CERT'));

/**
 * Whether a failed request certainly never reached the server: somewhere in
 * its chain of causes is the code of a connection that was never made, as
 * `fetch` reports it (`TypeError: fetch failed`, caused by the socket error).
 * Any other failure without a response, such as a timeout or a reset, may
 * have come after the server received the request.
 *
 * @param error The failure of the request.
 * @returns `true` when the request was never sent.
 * @internal
 */
const isUnsentRequestError = (error) => {
  let current = error;
  for (let depth = 0; depth < 4 && current != null; depth++) {
    if (isUnsentCode(current.code)) return true;
    current = current.cause;
  }
  return false;
};

module.exports = { isUnsentRequestError };
