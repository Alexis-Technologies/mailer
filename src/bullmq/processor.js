// Not ported: a BullMQ processor of a queue handler: a job of BullMQ as a run
// of the handler, and its outcome as BullMQ takes it: a return for an ack,
// an error with its delay for a retry, an `UnrecoverableError` for a failure,
// and a job moved back for a release, which spends no attempt.

const { warnThrown } = require('../internal/callback.js');
const { checkOptionalFunction } = require('../internal/options.js');
const { checkRetainData } = require('../internal/queue-options.js');
const { redactAddresses } = require('../internal/redact-addresses.js');
const { namedError, rateLimitError, retryError } = require('./backoff.js');

const jobOf = (job) => ({
  id: job.id,
  name: job.name,
  data: job.data,
  attempt: job.attemptsMade + 1,
  maxAttempts: job.opts?.attempts ?? 1,
  enqueuedAt: job.timestamp,
  redelivered: (job.stalledCounter ?? 0) > 0,
  redeliveries: job.stalledCounter ?? 0,
});

// A job given back, by the means its version of BullMQ has.
const release = async (job, token, outcome, now) => {
  const delay = outcome.delayMilliseconds;
  if (
    token !== undefined &&
    delay !== undefined &&
    delay > 0 &&
    typeof job.moveToDelayed === 'function'
  ) {
    await job.moveToDelayed(now() + delay, token);
    throw namedError('DelayedError', 'Released to the queue.');
  }
  if (token !== undefined && typeof job.moveToWait === 'function') {
    await job.moveToWait(token);
    throw namedError('WaitingError', 'Released to the queue.');
  }
  // Without a token, a retry, which spends the attempt.
  throw retryError({
    delayMilliseconds: Math.max(1000, delay ?? 0),
    code: 'queue.released',
    reason: 'released to the queue',
  });
};

// The data of a job done with, by `retainData`: its version and its hash,
// by which an enqueue again is still told a duplicate, and no message. A
// store that fails it leaves the message there, and the send stands.
const dropData = async (job) => {
  if (typeof job.updateData !== 'function') return;
  const kept = {};
  if (job.data?.v !== undefined) kept.v = job.data.v;
  if (typeof job.data?.hash === 'string') kept.hash = job.data.hash;
  try {
    await job.updateData(kept);
  } catch (error) {
    warnThrown('The data of a finished BullMQ job', error, 'MAILER_QUEUE_RETAIN_FAILED');
  }
};

/**
 * Makes a BullMQ processor of a queue handler, for a `Worker` of your own.
 * Its worker needs `settings.backoffStrategy` from
 * `createBullMQBackoffStrategy()`.
 *
 * @param handler The handler, such as `createMailJobHandler()`.
 * @param options `rateLimit(ms)`, the queue's `rateLimit`, for a retry of the
 * whole queue (it needs the worker's `limiter`); `signal`; `retainData`
 * ('failed'), the finished jobs whose data is kept; `now`.
 * @returns The processor, with `shutdown(reason)`, which aborts the jobs it
 * runs.
 * @throws {TypeError} If the handler is not a function.
 */
const createBullMQProcessor = (handler, options = {}) => {
  if (typeof handler !== 'function') throw new TypeError('createBullMQProcessor needs a handler.');
  const { rateLimit } = options;
  if (rateLimit !== undefined && typeof rateLimit !== 'function') {
    throw new TypeError('rateLimit must be a function.');
  }
  const retainData = checkRetainData(options.retainData);
  const now = checkOptionalFunction(options.now, 'now') ?? Date.now;
  const shutdown = new AbortController();
  const signals = [shutdown.signal];
  if (options.signal !== undefined) signals.push(options.signal);
  // Three parameters, so that BullMQ passes its signal (from 5.7x).
  const processor = async (job, token, signal) => {
    const run = jobOf(job);
    const aborted = AbortSignal.any(signal === undefined ? signals : [...signals, signal]);
    let outcome;
    try {
      outcome = await handler(run, aborted);
    } catch (error) {
      warnThrown('The handler of a BullMQ queue', error, 'MAILER_QUEUE_HANDLER_THREW');
      outcome = {
        type: 'retry',
        delayMilliseconds: 1000 * run.attempt,
        code: 'queue.handler_threw',
        reason: 'The handler threw.',
      };
    }
    switch (outcome?.type) {
      case 'ack':
        if (retainData !== 'all') await dropData(job);
        return outcome.result ?? null;
      case 'retry':
        if (outcome.scope === 'queue' && rateLimit !== undefined) {
          await rateLimit(outcome.delayMilliseconds);
          throw rateLimitError();
        }
        throw retryError(outcome);
      case 'fail':
        if (retainData === 'none') await dropData(job);
        // Its reason goes into the dashboards of the queue.
        throw namedError(
          'UnrecoverableError',
          redactAddresses(`${outcome.code}: ${outcome.reason}`),
        );
      case 'release':
        return release(job, token, outcome, now);
      default:
        throw namedError(
          'UnrecoverableError',
          'queue.invalid_outcome: The handler gave no outcome.',
        );
    }
  };
  processor.shutdown = (reason) => shutdown.abort(reason);
  return processor;
};

module.exports = { createBullMQProcessor };
