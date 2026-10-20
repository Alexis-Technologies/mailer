// Not ported: a queue driver over a source that lends its jobs (a store's
// outbox, the memory queue): lanes that reserve a job, keep its lease while
// it runs, and settle it by what the handler made of it, written once for
// every such source.

const { combineSignals } = require('../core/abort-signal.js');
const { warnThrown } = require('./callback.js');
const { createLog } = require('./log.js');
const { checkOptionalFunction, checkPositiveInteger } = require('./options.js');
const { settledWithin } = require('./settle.js');
const { sleep } = require('./sleep.js');

const DEFAULTS = Object.freeze({
  pollIntervalMilliseconds: 1000,
  leaseMilliseconds: 60_000,
  defaultRetryDelayMilliseconds: 1000,
});

/**
 * The reason a job's signal aborts when its lease is lost: another worker
 * may run it now.
 */
class QueueLeaseLostError extends Error {
  constructor(jobId) {
    super(`The lease of job ${jobId} was lost.`);
    this.name = 'QueueLeaseLostError';
  }
}

const checkSource = (source) => {
  for (const name of ['enqueue', 'reserve', 'extend', 'ack', 'retry', 'fail', 'release']) {
    if (typeof source?.[name] !== 'function') {
      throw new TypeError(`A queue source has ${name}(): ${String(source?.id ?? source)}`);
    }
  }
  if (typeof source.id !== 'string') throw new TypeError('A queue source has an id.');
  return source;
};

const createPollingConfig = (options) => {
  const config = { ...DEFAULTS };
  for (const name of Object.keys(DEFAULTS)) {
    if (options[name] !== undefined) config[name] = checkPositiveInteger(options[name], name);
  }
  config.now = checkOptionalFunction(options.now, 'now') ?? Date.now;
  config.sleep = checkOptionalFunction(options.sleep, 'sleep') ?? sleep;
  return config;
};

// The wakes of the source's listener, each for one lane: a change (a job
// enqueued) wakes the lane that waited longest rather than every lane of the
// process, which would all reserve at once for one job. A wake that comes
// while every lane is busy is kept for the next one to wait.
const createWaker = (source) => {
  const waiting = new Set();
  let pending = false;
  const wake = () => {
    for (const controller of waiting) {
      waiting.delete(controller);
      controller.abort();
      return;
    }
    pending = true;
  };
  const unsubscribe = typeof source.subscribe === 'function' ? source.subscribe(wake) : undefined;
  return {
    // The signal of one wait, aborted by a wake.
    take() {
      const controller = new AbortController();
      if (pending) {
        pending = false;
        controller.abort();
      } else {
        waiting.add(controller);
      }
      return controller;
    },
    release(controller) {
      waiting.delete(controller);
    },
    unsubscribe: () => unsubscribe?.(),
  };
};

// Settles a lease by the outcome of its run.
const settle = async (source, lease, outcome, config) => {
  const { job } = lease;
  const now = config.now();
  switch (outcome?.type) {
    case 'ack':
      return source.ack(lease, outcome.result);
    case 'retry': {
      const failure = { code: outcome.code, reason: outcome.reason };
      if (job.attempt >= job.maxAttempts) {
        return source.fail(lease, {
          code: 'queue.attempts_exhausted',
          reason: `${failure.code}: ${failure.reason}`,
        });
      }
      if (outcome.scope === 'queue' && typeof source.pause === 'function') {
        await source.pause(now + outcome.delayMilliseconds);
      }
      // The tenant's jobs wait, where the source keeps whose a job is.
      if (
        outcome.scope === 'tenant' &&
        job.tenantId !== undefined &&
        typeof source.pause === 'function'
      ) {
        await source.pause(now + outcome.delayMilliseconds, { tenantId: job.tenantId });
      }
      return source.retry(lease, now + outcome.delayMilliseconds, failure);
    }
    case 'fail':
      return source.fail(lease, { code: outcome.code, reason: outcome.reason });
    case 'release':
      return source.release(
        lease,
        outcome.delayMilliseconds === undefined ? undefined : now + outcome.delayMilliseconds,
      );
    default:
      return source.fail(lease, {
        code: 'queue.invalid_outcome',
        reason: 'The handler gave no outcome.',
      });
  }
};

/**
 * Makes a queue driver of a source that lends its jobs.
 *
 * @param source The source: `enqueue`, `reserve`, `extend`, `ack`, `retry`,
 * `fail`, `release`, and optionally `pause` and `subscribe`.
 * @param options `pollIntervalMilliseconds` (1000), `leaseMilliseconds`
 * (60000), `defaultRetryDelayMilliseconds` (1000), `now`, `sleep`, `logger`.
 * @returns The driver.
 * @throws {TypeError} If the source or an option is invalid.
 */
const createPollingDriver = (source, options = {}) => {
  checkSource(source);
  const config = createPollingConfig(options);
  const log = createLog(options.logger, { component: 'queue', queue: source.id });
  return {
    id: source.id,
    enqueue: (request, enqueueOptions) => source.enqueue(request, enqueueOptions),
    consume(handler, consumeOptions = {}) {
      if (typeof handler !== 'function') throw new TypeError('consume() needs a handler.');
      const concurrency = checkPositiveInteger(consumeOptions.concurrency ?? 1, 'concurrency');
      return startConsumer(source, handler, concurrency, consumeOptions.signal, config, log);
    },
  };
};

const runLease = async (source, handler, lease, jobsSignal, config, log) => {
  const lost = new AbortController();
  const { signal, cleanup } = combineSignals(jobsSignal, lost.signal);
  const every = Math.max(1, Math.floor(config.leaseMilliseconds / 3));
  // When the lease was last taken or extended: it runs out a lease after.
  let keptAt = config.now();
  const keep = async () => {
    try {
      const kept = await source.extend(lease, config.leaseMilliseconds);
      if (!kept) lost.abort(new QueueLeaseLostError(lease.job.id));
      else keptAt = config.now();
    } catch (error) {
      log.write(
        'warn',
        () => ({ jobId: lease.job.id, error: error?.message }),
        'queue.lease.extend_failed',
      );
      // The store does not answer: past the next keep the lease will have run
      // out, and another worker may take the job. The run stops now, before
      // it sends what the other would send too.
      if (config.now() - keptAt + every >= config.leaseMilliseconds) {
        lost.abort(new QueueLeaseLostError(lease.job.id));
      }
    }
  };
  const keeper = setInterval(keep, every);
  // A run that never ends does not keep the process alive by its lease.
  keeper.unref?.();
  let outcome;
  try {
    outcome = await handler(lease.job, signal);
  } catch (error) {
    warnThrown('The handler of a queue', error, 'MAILER_QUEUE_HANDLER_THREW');
    outcome = {
      type: 'retry',
      delayMilliseconds: config.defaultRetryDelayMilliseconds * lease.job.attempt,
      code: 'queue.handler_threw',
      reason: 'The handler threw.',
    };
  } finally {
    clearInterval(keeper);
    cleanup();
  }
  // Another worker may hold the job now: what this run made of it is moot.
  if (lost.signal.aborted) {
    log.write('warn', () => ({ jobId: lease.job.id }), 'queue.lease.lost');
    return;
  }
  try {
    const settled = await settle(source, lease, outcome, config);
    // The lease ran out between the run and its settling: another worker
    // holds the job, and what this run did may be done again.
    if (settled === false) {
      log.write(
        'warn',
        () => ({ jobId: lease.job.id, outcome: outcome?.type }),
        'queue.settle_fenced',
      );
    }
  } catch (error) {
    // The lease runs out, and the job comes back.
    log.write(
      'warn',
      () => ({ jobId: lease.job.id, error: error?.message }),
      'queue.settle_failed',
    );
  }
};

const startConsumer = (source, handler, concurrency, outerSignal, config, log) => {
  const stopping = new AbortController();
  const jobs = new AbortController();
  const waker = createWaker(source);
  const onOuterAbort = () => stopping.abort();
  outerSignal?.addEventListener('abort', onOuterAbort, { once: true });
  if (outerSignal?.aborted) stopping.abort();
  const wait = async (milliseconds) => {
    const woken = waker.take();
    const { signal, cleanup } = combineSignals(stopping.signal, woken.signal);
    try {
      await config.sleep(milliseconds, signal);
    } catch {
      // Woken: a job may be ready, or the consumer stops.
    } finally {
      cleanup();
      waker.release(woken);
    }
  };
  const lane = async () => {
    while (!stopping.signal.aborted) {
      let reserved;
      try {
        reserved = await source.reserve(config.leaseMilliseconds);
      } catch (error) {
        log.write('warn', () => ({ error: error?.message }), 'queue.reserve_failed');
        await wait(config.pollIntervalMilliseconds);
        continue;
      }
      if (reserved?.lease !== undefined) {
        await runLease(source, handler, reserved.lease, jobs.signal, config, log);
        continue;
      }
      const due = reserved?.nextAvailableAt;
      const until = due === undefined ? config.pollIntervalMilliseconds : due - config.now();
      await wait(Math.max(1, Math.min(config.pollIntervalMilliseconds, until)));
    }
  };
  const lanes = [];
  for (let index = 0; index < concurrency; index++) lanes.push(lane());
  const all = Promise.all(lanes);
  return {
    async close(closeOptions = {}) {
      stopping.abort();
      const timeout = closeOptions.timeoutMilliseconds ?? 30_000;
      // The jobs still running past the timeout are told to stop: one not
      // yet sent goes back. One that does not hear it is left, its lease to
      // run out, after as long again.
      if ((await settledWithin(all, timeout)) === 'timeout') {
        jobs.abort(new DOMException('The consumer closed.', 'AbortError'));
        if ((await settledWithin(all, timeout)) === 'timeout') {
          log.write('warn', () => ({ timeoutMilliseconds: timeout }), 'queue.close_abandoned');
        }
      }
      outerSignal?.removeEventListener('abort', onOuterAbort);
      waker.unsubscribe();
    },
  };
};

module.exports = { QueueLeaseLostError, createPollingDriver };
