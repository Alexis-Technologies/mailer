// Not ported: `verify()` of an HTTP provider, one authenticated read of its
// API, retried as a read is and never taken for a delivery.

const { readText } = require('./body.js');
const { requestWithRetry } = require('./http.js');

const MAX_DETAIL = 200;

const detailOf = (text) => {
  const trimmed = text.trim();
  return trimmed.length > MAX_DETAIL ? `${trimmed.slice(0, MAX_DETAIL)}…` : trimmed;
};

const failureOf = (provider, status, text) => {
  const detail = detailOf(text);
  const reason =
    status === 401 ? 'refused the credentials' : `answered the check with HTTP ${status}`;
  const error = new Error(`${provider} ${reason}${detail === '' ? '.' : `: ${detail}`}`);
  error.statusCode = status;
  return error;
};

/**
 * Verifies the credentials of an HTTP provider with one read of its API.  A
 * 2xx verifies them; so does a 403, which says the key is known but may not
 * read what was asked (a key that may only send); a 401, or any other
 * status, fails.
 *
 * @param request `provider`, the name in the error; `send(signal)`, the
 * authenticated request; `check(status, body)`, which may throw on a 2xx or
 * return `true` to accept another status; and `retries`, `timeoutMs`,
 * `signal` and `log` of the transport.
 * @throws {Error} With the `statusCode` of the answer, if the check fails.
 * @internal
 */
const verifyByRequest = async (request) => {
  let answer;
  try {
    answer = await requestWithRetry({
      log: request.log,
      signal: request.signal,
      retries: request.retries,
      timeoutMs: request.timeoutMs,
      isIdempotent: true,
      send: request.send,
      read: async (response) => ({ status: response.status, body: await readText(response) }),
      reject: async (response) => {
        const text = await readText(response);
        if (response.status === 403 || request.check?.(response.status, text) === true) {
          // Not retried, as its status says, and caught below.
          return Object.assign(new Error('Verified.'), { verified: true, statusCode: 403 });
        }
        return failureOf(request.provider, response.status, text);
      },
    });
  } catch (error) {
    if (error?.verified === true) return;
    throw error;
  }
  request.check?.(answer.status, answer.body);
};

/**
 * Verifies the credentials of a transport with one authenticated read of
 * `url`, a GET by default.
 *
 * @param transport The transport, with its `config` and `httpClient`.
 * @param label The provider's name, for the error.
 * @param url The URL read.
 * @param options The caller's options.
 * @param request `init` of the request in place of a GET, and `check`.
 * @internal
 */
const verifyByGet = async (transport, label, url, options, request = {}) => {
  options?.signal?.throwIfAborted();
  const init = request.init ?? { method: 'GET', headers: { Accept: 'application/json' } };
  return verifyByRequest({
    provider: label,
    send: (signal) => transport.httpClient.fetchWithAuth(url, init, signal),
    check: request.check,
    retries: transport.config.retries,
    timeoutMs: transport.config.timeout,
    signal: options?.signal,
    log: transport.httpClient.log,
  });
};

module.exports = { verifyByGet, verifyByRequest };
