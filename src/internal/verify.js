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
 * 2xx verifies them; so does a 403 with `acceptForbidden`, for a provider
 * whose keys that may only send are refused that read with it; a 401, or
 * any other status, fails, unless `check` takes it.
 *
 * @param request `provider`, the name in the error; `send(signal)`, the
 * authenticated request; `check(status, body)`, which may throw on a 2xx or
 * return `true` to take another status; `acceptForbidden`; and `retries`,
 * `timeoutMs`, `signal` and `log` of the transport.
 * @throws {Error} With the `statusCode` of the answer, if the check fails.
 * @internal
 */
const verifyByRequest = (request) =>
  requestWithRetry({
    log: request.log,
    signal: request.signal,
    retries: request.retries,
    timeoutMs: request.timeoutMs,
    isIdempotent: true,
    send: request.send,
    // Every answer is read, as the check reads the body of a refusal; one it
    // does not take fails with its status, retried as that says.
    accepts: () => true,
    read: async (response) => {
      const { status } = response;
      const body = await readText(response);
      if (status >= 200 && status <= 299) {
        request.check?.(status, body);
        return;
      }
      if (status === 403 && request.acceptForbidden === true) return;
      if (request.check?.(status, body) === true) return;
      throw failureOf(request.provider, status, body);
    },
  });

/**
 * Verifies the credentials of a transport with one authenticated read of
 * `url`, a GET by default.
 *
 * @param transport The transport, with its `config` and `httpClient`.
 * @param label The provider's name, for the error.
 * @param url The URL read.
 * @param options The caller's options.
 * @param request `init` of the request in place of a GET, `check` and
 * `acceptForbidden`.
 * @internal
 */
const verifyByGet = async (transport, label, url, options, request = {}) => {
  options?.signal?.throwIfAborted();
  const init = request.init ?? { method: 'GET', headers: { Accept: 'application/json' } };
  return verifyByRequest({
    provider: label,
    send: (signal) => transport.httpClient.fetchWithAuth(url, init, signal),
    check: request.check,
    acceptForbidden: request.acceptForbidden,
    retries: transport.config.retries,
    timeoutMs: transport.config.timeout,
    signal: options?.signal,
    log: transport.httpClient.log,
  });
};

module.exports = { verifyByGet, verifyByRequest };
