// Not ported: the wait of a retry or a delay, which upstream wrote in
// five ways, some deaf to the AbortSignal or rejecting with an error of their
// own instead of its reason.

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
    }, timerMs(milliseconds));
    signal?.addEventListener('abort', onAbort, { once: true });
  });

// The longest delay a timer keeps on Node, Bun and Deno: a longer one fires at
// once (Node and Bun) or throws (AbortSignal.timeout past 2^32 - 1).
const MAX_TIMER_MS = 2_147_483_647;

/**
 * A delay a timer can take: one longer than the longest a timer keeps, some
 * 24.8 days, is cut to it, where a timer would fire at once.  A timeout that
 * long is in effect none.
 *
 * @param milliseconds The delay asked for.
 * @returns The delay to give the timer.
 * @internal
 */
const timerMs = (milliseconds) => (milliseconds > MAX_TIMER_MS ? MAX_TIMER_MS : milliseconds);

module.exports = { abortReason, sleep, timerMs };
