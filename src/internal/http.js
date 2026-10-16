// Not ported from upyo: the retry loop that the HTTP providers carried as
// copies.  A provider keeps what is its own (the request, its errors, what it
// retries and how long it waits) and passes it in.

const { combineSignals } = require('../core/abort-signal.js');
const { markDeliveryUnknown } = require('./delivery-unknown.js');

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
 * says to retry.  A failure after a 2xx response is never retried: the
 * provider took the request, so it is thrown marked as of unknown delivery,
 * unless the request is idempotent.
 *
 * @param request What the provider passes in:
 * - `send(signal, attempt)`: one fetch, with the signal of the attempt;
 * - `read(response, attempt)`: the result of a 2xx response;
 * - `reject(response, attempt)`: the error of any other response;
 * - `isRetryable(error)`, `retryDelayMs(attempt, error)`;
 * - `retries`, `timeoutMs`, `signal`;
 * - `createTimeoutError(error)`: the error of an expired deadline, by default
 *   the `AbortError` itself;
 * - `finalError(error, attempts)`: the error thrown once retries are spent,
 *   by default the last failure;
 * - optional `wrapAccepted(error, attempts)`, `isAnswer(error)` (an error that
 *   is the provider's own answer in a 2xx, such as a refusal in its body,
 *   thrown as it is rather than as of unknown delivery), `isIdempotent`,
 *   `sleep`.
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
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const deadline = startDeadline(request.timeoutMs, signal);
    let isAccepted = false;
    let failure;
    try {
      const response = await request.send(deadline.signal, attempt);
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
    if (isAccepted && request.isIdempotent !== true) {
      if (request.isAnswer?.(failure) === true) throw failure;
      const accepted = request.wrapAccepted?.(failure, attempt + 1) ?? failure;
      throw markDeliveryUnknown(accepted);
    }
    if (!request.isRetryable(failure)) throw failure;
    const retryAfterMs = Number.isFinite(failure.retryAfterMilliseconds)
      ? failure.retryAfterMilliseconds
      : 0;
    if (attempt >= request.retries || retryAfterMs > MAX_RETRY_AFTER_WAIT_MS) {
      throw request.finalError?.(failure, attempt + 1) ?? failure;
    }
    await wait(Math.max(request.retryDelayMs(attempt, failure), retryAfterMs), signal);
  }
};

module.exports = {
  abortReason,
  checkRequestOptions,
  exponentialDelayMs,
  isAbortError,
  jitteredDelayMs,
  requestWithRetry,
  sleep,
};
