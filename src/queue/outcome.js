// Not ported: what the queue does with the receipt of an attempt.  A
// permanent failure is not tried again, where a queue that retries every
// failure sends a refused message three times and a missing template three
// times more; a retryable one is, after at least the delay the provider asked
// for; and one of unknown delivery is not, as it may have been taken.

const { computeBackoff, retryAfterOf } = require('../internal/backoff.js');
const { redactAddresses } = require('../internal/redact-addresses.js');

// The failures of the operator rather than of the message: a key revoked, a
// domain not verified. They may pass once fixed, after a longer wait.
const OPERATOR = new Set(['auth', 'configuration']);
const MAX_REASON = 500;

/**
 * The reason of a failure, its addresses redacted and its length bounded:
 * it goes into the store of the queue and its dashboards.
 *
 * @internal
 */
const reasonOf = (text) => {
  const redacted = redactAddresses(String(text));
  return redacted.length > MAX_REASON ? `${redacted.slice(0, MAX_REASON)}…` : redacted;
};

const firstError = (receipt) => (Array.isArray(receipt.errors) ? receipt.errors[0] : undefined);

/**
 * The audit error of a failed receipt.
 *
 * @internal
 */
const auditErrorOf = (receipt) => {
  const error = firstError(receipt);
  return {
    category: error?.category ?? 'unknown',
    code: error?.code ?? 'unknown',
    message: reasonOf(receipt.errorMessages?.join('; ') ?? error?.message ?? 'failed'),
    retryable: receipt.retryable === true,
  };
};

const isRetryable = (receipt) => {
  if (receipt.retryable !== undefined) return receipt.retryable === true;
  if (!Array.isArray(receipt.errors)) return false;
  for (const error of receipt.errors) {
    if (error.retryable) return true;
  }
  return false;
};

/**
 * The delay before the next attempt: exponential with full jitter, but never
 * shorter than the provider's `Retry-After`, which gets a little jitter of
 * its own so that a rate limit does not bring every job back at once.
 *
 * @internal
 */
const retryDelayOf = (attempt, receipt, config) => {
  const backoff = computeBackoff(attempt, config.backoff, 'full', config.random);
  const after = retryAfterOf(receipt);
  if (after === undefined || !Number.isFinite(after) || after < 0) return backoff;
  const spread = Math.floor(config.random() * Math.min(after * 0.1, 5000));
  return Math.max(backoff, after + spread);
};

/**
 * What the queue does with a failed receipt, and the state of the message.
 *
 * @param receipt The failed receipt.
 * @param job The run of the job.
 * @param config `backoff`, `random`, `now`, `operatorDelayMilliseconds`,
 * `rateLimitScope`, `classify`, and `expiresAt` and `tenantId` of the job, if any.
 * @returns `{ outcome, state, error }`.
 * @internal
 */
const outcomeOfFailure = (receipt, job, config) => {
  const error = auditErrorOf(receipt);
  const code = error.code;
  const reason = error.message;
  const decided = config.classify?.({ receipt, job });
  if (receipt.deliveryUnknown === true || decided === 'delivery_unknown') {
    return { outcome: { type: 'fail', code, reason }, state: 'delivery_unknown', error };
  }
  const operator = OPERATOR.has(error.category);
  const retryable = decided === undefined ? operator || isRetryable(receipt) : decided === 'retry';
  if (!retryable) return { outcome: { type: 'fail', code, reason }, state: 'failed', error };
  if (job.attempt >= job.maxAttempts) {
    return {
      outcome: { type: 'fail', code: 'queue.attempts_exhausted', reason: `${code}: ${reason}` },
      state: 'failed',
      error,
    };
  }
  const delay = operator
    ? config.operatorDelayMilliseconds
    : retryDelayOf(job.attempt, receipt, config);
  if (config.expiresAt !== undefined && config.now() + delay > config.expiresAt) {
    return {
      outcome: { type: 'fail', code: 'queue.expired', reason: `${code}: ${reason}` },
      state: 'failed',
      error,
    };
  }
  // A rate limit makes the queue, or the job's tenant, wait where asked; a
  // job of no tenant waits alone.
  let scope = 'job';
  if (error.category === 'rate-limit' && config.rateLimitScope === 'queue') scope = 'queue';
  if (
    error.category === 'rate-limit' &&
    config.rateLimitScope === 'tenant' &&
    config.tenantId !== undefined
  ) {
    scope = 'tenant';
  }
  return {
    outcome: { type: 'retry', delayMilliseconds: delay, code, reason, scope },
    state: 'queued',
    error,
  };
};

module.exports = { auditErrorOf, outcomeOfFailure, reasonOf, retryDelayOf };
