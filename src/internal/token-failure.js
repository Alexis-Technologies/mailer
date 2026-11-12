// Not ported: the request of a token of OAuth 2.0 (Google's for a service
// account, Microsoft's for a bot): its deadline, the timeout of its transport;
// its answer; its failure: credentials refused are `auth`, which a retry does
// not mend, the rest as their status says, and the request of the provider
// that waited for the token was never sent; and the token a provider refuses,
// dropped.

const { timerMs } = require('./sleep.js');
const { markUnsent } = require('./unsent.js');

// The most of the reason of a refusal kept: its answer may be a page of HTML
// of 64 KiB.
const MAX_REASON_LENGTH = 300;

const textOf = (value) => {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return undefined;
  // An `error` of an object, as some gateways write it, rather than
  // "[object Object]".
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

/**
 * The failure of a request of a token.
 *
 * @param refused What refused, such as "Google refused the token of the service account".
 * @param status The status of the answer.
 * @param json The answer read as JSON, if it is.
 * @param text The answer as text.
 * @returns The error, marked unsent.
 * @internal
 */
const tokenFailure = (refused, status, json, text) => {
  const reason =
    textOf(json?.error_description) ??
    textOf(json?.error) ??
    (text.trim() === '' ? `HTTP ${status}` : text.trim());
  const bounded =
    reason.length > MAX_REASON_LENGTH ? `${reason.slice(0, MAX_REASON_LENGTH)}…` : reason;
  const error = new Error(`${refused}: ${bounded}`);
  error.statusCode = status;
  if (status === 400 || status === 401 || status === 403) {
    error.category = 'auth';
    error.retryable = false;
  }
  return markUnsent(error);
};

/**
 * The deadline of a request of a token: the timeout of its transport, where
 * 0 and Infinity mean none, as for every request (bug 28). The token is
 * shared, so no caller's signal ends its request.
 *
 * @param timeoutMs The timeout, in milliseconds.
 * @returns The signal, or `undefined` for none.
 * @internal
 */
const tokenSignalOf = (timeoutMs) =>
  timeoutMs > 0 && Number.isFinite(timeoutMs) ? AbortSignal.timeout(timerMs(timeoutMs)) : undefined;

/**
 * The answer of an endpoint of tokens as JSON, or `undefined`.
 *
 * @internal
 */
const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * A `fetch` that drops the token a 401 refuses, so that the next request asks
 * for another (and `refreshesToken` of the shared client sends it once more).
 *
 * @param fetch The fetch of the transport, or none for the global one.
 * @param auth The source of the token, with `invalidate(token)`, or none.
 * @returns The fetch.
 * @internal
 */
const fetchDroppingRefused = (fetch, auth) => async (url, init) => {
  const response = await (fetch ?? globalThis.fetch)(url, init);
  if (response.status === 401 && auth !== undefined) {
    const token = new Headers(init.headers).get('authorization')?.slice('Bearer '.length);
    if (token !== undefined) auth.invalidate(token);
  }
  return response;
};

module.exports = { fetchDroppingRefused, parseJson, tokenFailure, tokenSignalOf };
