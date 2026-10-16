// Not ported from upyo: the retry loop that the HTTP providers carried as
// copies.  A provider keeps what is its own (the request, its errors, what it
// retries and how long it waits) and passes it in.

const { combineSignals } = require('../core/abort-signal.js');
const { markDeliveryUnknown } = require('./delivery-unknown.js');
const { isUnsentRequestError } = require('./unsent.js');

const isAbortError = (error) => error instanceof Error && error.name === 'AbortError';

/**
 * The reason of an aborted signal, or an `AbortError` when it has none.
 *
 * @param signal The aborted signal.
 * @returns The value to reject or throw with.
 * @internal
 */
const abortReason = (signal) =>
  signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');

/**
 * Waits, and stops waiting when the signal aborts, rejecting with its reason.
 *
 * @param milliseconds How long to wait.
 * @param signal The caller's signal.
 * @returns A promise settled when the wait ends.
 * @internal
 */
const sleep = (milliseconds, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * The delay before retry `attempt` (from 0): one second, doubled each time.
 *
 * @param attempt The attempt that failed, from 0.
 * @returns The delay in milliseconds.
 * @internal
 */
const exponentialDelayMs = (attempt) => 1000 * 2 ** attempt;

/**
 * The exponential delay capped at ten seconds, then spread over its upper half
 * so that clients that failed together do not retry together.
 *
 * @param attempt The attempt that failed, from 0.
 * @returns The delay in milliseconds.
 * @internal
 */
const jitteredDelayMs = (attempt) => {
  const baseMs = Math.min(exponentialDelayMs(attempt), 10_000);
  return Math.round(baseMs / 2 + Math.random() * (baseMs / 2));
};

/**
 * Whether a response status may succeed when the request is sent again: a
 * request timeout (408), too many requests (429) or a server error (5xx).
 *
 * @param statusCode The HTTP status of the response.
 * @returns `true` when a retry may succeed.
 * @internal
 */
const isRetryableStatus = (statusCode) =>
  statusCode === 408 || statusCode === 429 || statusCode >= 500;

// A failure without a status (the network, a timeout) may pass on a retry;
// one with a status, only as isRetryableStatus() says.
const isRetryableFailure = (error) =>
  error.statusCode === undefined || isRetryableStatus(error.statusCode);

// The longest Retry-After a send waits for between two attempts; beyond it the
// failure is thrown with its delay, for the caller or a queue to schedule.
const MAX_RETRY_AFTER_WAIT_MS = 30_000;

// The deadline of one attempt, combined with the caller's signal.  A timeout
// of 0 or Infinity sets none: setTimeout() would fire at once for either.
const startDeadline = (timeoutMs, signal) => {
  const controller = new AbortController();
  const timer =
    timeoutMs > 0 && Number.isFinite(timeoutMs)
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
  const combined = combineSignals(controller.signal, signal);
  return {
    signal: combined.signal,
    get isExpired() {
      return controller.signal.aborted;
    },
    stop() {
      clearTimeout(timer);
      combined.cleanup();
    },
  };
};

/**
 * Sends a request with a deadline per attempt, retrying what the provider
 * says to retry.
 *
 * A failure that leaves it unknown whether the provider took the request is
 * ambiguous: a failure after a 2xx, a gateway timeout (504), and a failure
 * without any response, unless its causes show that the connection was never
 * made.  Sending the request again after one could deliver the message twice,
 * so an ambiguous failure is thrown at once, marked as of unknown delivery.
 * A request with an idempotency key (`hasIdempotencyKey`), which the provider
 * deduplicates, is retried after one instead, and its last failure is marked
 * if any attempt was ambiguous.  A read (`isIdempotent`) is retried with no
 * marking at all.
 *
 * @param request What the provider passes in:
 * - `send(signal, attempt)`: one fetch, with the signal of the attempt;
 * - `read(response, attempt)`: the result of a 2xx response;
 * - `reject(response, attempt)`: the error of any other response;
 * - `retries`, `timeoutMs`, `signal`;
 * - `isRetryable(error)`: by default, a failure without a status or with a
 *   retryable one (`isRetryableStatus`), from the `statusCode` that every
 *   provider error carries;
 * - `retryDelayMs(attempt, error)`: by default `jitteredDelayMs`;
 * - `createTimeoutError(error)`: the error of an expired deadline, by default
 *   the `AbortError` itself;
 * - `finalError(error, attempts)`: the error thrown once retries are spent,
 *   by default the last failure;
 * - optional `wrapAccepted(error, attempts)`, `isAnswer(error)` (an error that
 *   is the provider's own answer in a 2xx, such as a refusal in its body,
 *   thrown as it is rather than as of unknown delivery), `hasIdempotencyKey`,
 *   `isIdempotent`, `sleep`.
 * The deadline of an attempt lasts until its response is read, body
 * included, so a body that never ends cannot hold a send.  Between attempts
 * it waits at least the failure's `retryAfterMilliseconds`, the server's
 * `Retry-After`, and does not retry when that is longer than 30 seconds.
 * @returns What `read` returns.
 * @internal
 */
const requestWithRetry = async (request) => {
  const signal = request.signal;
  const wait = request.sleep ?? sleep;
  const isRead = request.isIdempotent === true;
  const hasKey = request.hasIdempotencyKey === true;
  let wasAmbiguous = false;
  // The last failure, marked when an attempt left the delivery unknown.
  const settle = (error) => (wasAmbiguous && !isRead ? markDeliveryUnknown(error) : error);
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const deadline = startDeadline(request.timeoutMs, signal);
    let hasResponse = false;
    let isAccepted = false;
    let failure;
    try {
      const response = await request.send(deadline.signal, attempt);
      hasResponse = true;
      isAccepted = response.ok;
      if (response.ok) return await request.read(response, attempt);
      failure = await request.reject(response, attempt);
    } catch (error) {
      const isTimeout = deadline.isExpired && !signal?.aborted && isAbortError(error);
      failure = isTimeout ? (request.createTimeoutError?.(error) ?? error) : error;
    } finally {
      deadline.stop();
    }
    if (!(failure instanceof Error)) failure = new Error(String(failure));

    if (signal?.aborted) throw abortReason(signal);
    if (isAccepted && request.isAnswer?.(failure) === true) throw settle(failure);
    const isAmbiguous =
      isAccepted || (hasResponse ? failure.statusCode === 504 : !isUnsentRequestError(failure));
    if (isAmbiguous && !isRead) {
      wasAmbiguous = true;
      if (!hasKey) {
        const wrapped = isAccepted ? request.wrapAccepted?.(failure, attempt + 1) : undefined;
        throw markDeliveryUnknown(wrapped ?? request.finalError?.(failure, attempt + 1) ?? failure);
      }
    }
    const isRetryable = isAccepted || (request.isRetryable ?? isRetryableFailure)(failure);
    if (!isRetryable) throw settle(failure);
    const retryAfterMs = Number.isFinite(failure.retryAfterMilliseconds)
      ? failure.retryAfterMilliseconds
      : 0;
    if (attempt >= request.retries || retryAfterMs > MAX_RETRY_AFTER_WAIT_MS) {
      throw settle(request.finalError?.(failure, attempt + 1) ?? failure);
    }
    const delayMs = (request.retryDelayMs ?? jitteredDelayMs)(attempt, failure);
    await wait(Math.max(delayMs, retryAfterMs), signal);
  }
};

module.exports = {
  abortReason,
  exponentialDelayMs,
  isAbortError,
  isRetryableStatus,
  jitteredDelayMs,
  requestWithRetry,
  sleep,
};
