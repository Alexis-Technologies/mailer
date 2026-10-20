// Not ported: the checks of the options the queue and its drivers share
// (./queue, ./bullmq, ./mongodb), apart from those of the decorators so that
// an entry that has no queue carries none of them.

const { checkPositiveInteger } = require('./options.js');

/**
 * Checks a whole number of zero or more.
 *
 * @internal
 */
const checkNonNegativeInteger = (value, name) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a whole number of zero or more: ${String(value)}`);
  }
  return value;
};

// What a queue keeps of the data of a finished job: all of it, that of the
// failed ones (for a retry by hand), or none.
const RETAIN_DATA = new Set(['all', 'failed', 'none']);

/**
 * Checks `retainData` of a queue, `'failed'` by default.
 *
 * @internal
 */
const checkRetainData = (value = 'failed') => {
  if (!RETAIN_DATA.has(value)) {
    throw new TypeError(`retainData must be 'all', 'failed' or 'none': ${String(value)}`);
  }
  return value;
};

// How long a store keeps a job done with: a completed one is its key's
// memory, the window in which an enqueue again is a duplicate; a failed one
// waits for a retry by hand. The same for every driver.
const DEFAULT_DEDUPE_WINDOW_SECONDS = 24 * 60 * 60;
const DEFAULT_RETAIN_FAILED_SECONDS = 7 * 24 * 60 * 60;

/**
 * Checks the retention of a queue: `dedupeWindowSeconds` (a day) and
 * `retainFailedSeconds` (a week).
 *
 * @internal
 */
const retentionOf = (options) => ({
  dedupeWindowSeconds: checkPositiveInteger(
    options.dedupeWindowSeconds ?? DEFAULT_DEDUPE_WINDOW_SECONDS,
    'dedupeWindowSeconds',
  ),
  retainFailedSeconds: checkPositiveInteger(
    options.retainFailedSeconds ?? DEFAULT_RETAIN_FAILED_SECONDS,
    'retainFailedSeconds',
  ),
});

module.exports = { checkNonNegativeInteger, checkRetainData, retentionOf };
