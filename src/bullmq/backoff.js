// Not ported: how a retry of the queue reaches BullMQ: an error thrown by the
// processor, which BullMQ fails and retries, its delay read by a backoff
// strategy of the worker's from the error itself, so that the attempt counts
// in BullMQ as it does in the queue.  The errors are told apart by name, as
// BullMQ reads them, so the package imports nothing of it.

// The backoff type of mail jobs, read by the strategy below.
const MAILER_BACKOFF_TYPE = 'alexify-mailer';

// The delay of each retry the processor threw.
const delays = new WeakMap();
// The errors the processor threw, as opposed to those BullMQ fails a job
// with itself (a job stalled too often).
const settled = new WeakSet();

/**
 * The error of a retry, its delay kept for the strategy.
 *
 * @internal
 */
const retryError = (outcome) => {
  const error = new Error(`${outcome.code}: ${outcome.reason}`);
  delays.set(error, outcome.delayMilliseconds);
  settled.add(error);
  return error;
};

/**
 * An error BullMQ reads by its name: `UnrecoverableError`, `DelayedError`,
 * `WaitingError`.
 *
 * @internal
 */
const namedError = (name, message) => {
  const error = new Error(message);
  error.name = name;
  settled.add(error);
  return error;
};

/**
 * The error that tells BullMQ the queue is rate limited: the job goes back
 * without spending an attempt.
 *
 * @internal
 */
const rateLimitError = () => {
  const error = new Error('bullmq:rateLimitExceeded');
  settled.add(error);
  return error;
};

/**
 * Whether the processor threw this error.
 *
 * @internal
 */
const isSettledError = (error) => typeof error === 'object' && error !== null && settled.has(error);

/**
 * Makes the backoff strategy of a worker of mail jobs: the delay the queue
 * chose for a job of the type `alexify-mailer`, and `fallback` for the jobs
 * of other custom types.
 *
 * @param fallback The strategy of the worker's other jobs, if any.
 * @returns `(attemptsMade, type, err, job) => number`.
 * @throws {TypeError} If `fallback` is not a function.
 */
const createBullMQBackoffStrategy = (fallback) => {
  if (fallback !== undefined && typeof fallback !== 'function') {
    throw new TypeError('The fallback backoff strategy must be a function.');
  }
  return (attemptsMade, type, error, job) => {
    if (type === MAILER_BACKOFF_TYPE) {
      const delay = typeof error === 'object' && error !== null ? delays.get(error) : undefined;
      // A failure the processor did not decide, such as an error BullMQ made.
      return delay ?? 1000 * attemptsMade;
    }
    if (fallback !== undefined) return fallback(attemptsMade, type, error, job);
    throw new Error(`Unknown backoff strategy ${type}: give the worker's own as the fallback.`);
  };
};

module.exports = {
  MAILER_BACKOFF_TYPE,
  createBullMQBackoffStrategy,
  isSettledError,
  namedError,
  rateLimitError,
  retryError,
};
