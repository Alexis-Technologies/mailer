// Not ported: the delay between two attempts, shared by ./retry, which waits
// it in the process, and ./queue, which hands it to the queue to schedule.

/**
 * Whether a value is a `ReceiptError`: a message, a code, a category and
 * whether it is retryable.
 *
 * @internal
 */
const isReceiptError = (value) =>
  typeof value === 'object' &&
  value !== null &&
  typeof value.message === 'string' &&
  typeof value.code === 'string' &&
  typeof value.category === 'string' &&
  typeof value.retryable === 'boolean';

/**
 * The delay a failure asks to be waited before the next attempt: the
 * `retryAfterMilliseconds` of a receipt error, or the first one among the
 * errors of a failed receipt.
 *
 * @param failure A failed receipt, a receipt error, or nothing.
 * @returns The delay in milliseconds, or `undefined` when none is asked.
 * @internal
 */
const retryAfterOf = (failure) => {
  if (failure == null) return undefined;
  if (isReceiptError(failure)) return failure.retryAfterMilliseconds;
  if (failure.errors == null) return undefined;
  for (const error of failure.errors) {
    if (error.retryAfterMilliseconds != null) return error.retryAfterMilliseconds;
  }
  return undefined;
};

/**
 * The exponential delay before the attempt after `attempt`: the base delay
 * multiplied by the factor once per attempt made before it, at most the
 * longest delay, and with full jitter a random part of it.
 *
 * @param attempt The attempt that failed, from 1.
 * @param backoff `baseDelayMilliseconds`, `maxDelayMilliseconds` and `factor`.
 * @param jitter `'full'`, or `'none'` or `false` for none.
 * @param random A function giving a number in [0, 1).
 * @returns The delay in milliseconds.
 * @internal
 */
const computeBackoff = (attempt, backoff, jitter, random) => {
  const computedDelay = Math.min(
    backoff.baseDelayMilliseconds * Math.pow(backoff.factor, attempt - 1),
    backoff.maxDelayMilliseconds,
  );
  if (jitter === false || jitter === 'none') return computedDelay;
  return Math.floor(random() * computedDelay);
};

module.exports = { computeBackoff, isReceiptError, retryAfterOf };
