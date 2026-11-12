// Not ported: the request of a token of OAuth 2.0 (Google's for a service
// account, Microsoft's for a bot): its deadline, the timeout of its transport;
// and its failure: credentials refused are `auth`, which a retry does not
// mend, the rest as their status says, and the request of the provider that
// waited for the token was never sent.

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

module.exports = { tokenFailure, tokenSignalOf };
