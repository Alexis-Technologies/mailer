// Not ported from upyo: the wait of a retry or a delay, which upstream wrote in
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
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

module.exports = { abortReason, sleep };
