// Not ported: a queue driver over BullMQ, whose `Queue` and `Worker` the
// application passes in, so the package depends on neither BullMQ nor Redis.
// A job's id is its key, so an enqueue again is one job while BullMQ keeps
// it; its attempts and backoff are the queue's; its priority is ranked from
// 1, as 0 in BullMQ runs before every prioritized job.

const { warnThrown } = require('../internal/callback.js');
const { createLog } = require('../internal/log.js');
const { redactAddresses } = require('../internal/redact-addresses.js');
const { toUuid } = require('../internal/uuid.js');
const { checkPositiveInteger } = require('../internal/options.js');
const { checkRetainData, retentionOf } = require('../internal/queue-options.js');
const { settledWithin } = require('../internal/settle.js');
const {
  MAILER_BACKOFF_TYPE,
  createBullMQBackoffStrategy,
  isSettledError,
} = require('./backoff.js');
const { createBullMQProcessor } = require('./processor.js');

// What the driver sets on each job itself.
const RESERVED_JOB_OPTIONS = new Set([
  'attempts',
  'backoff',
  'jobId',
  'priority',
  'delay',
  'deduplication',
  'repeat',
  'parent',
  'lifo',
  'timestamp',
]);
const RESERVED_WORKER_OPTIONS = new Set(['connection', 'prefix', 'concurrency', 'autorun']);
// BullMQ's highest priority number, 2^21 - 1.
const MAX_PRIORITY = 2_097_151;
const DEFAULT_PRIORITIES = Object.freeze({ high: 1, normal: 2, low: 3 });
// The jobs of a batch read back at once to tell its duplicates.
const DUPLICATE_READS = 32;

const checkReserved = (options, reserved, what) => {
  if (options === undefined) return {};
  if (typeof options !== 'object' || options === null) {
    throw new TypeError(`${what} must be an object.`);
  }
  for (const name of Object.keys(options)) {
    if (reserved.has(name)) throw new TypeError(`${what}.${name} is set by the BullMQ driver.`);
  }
  return options;
};

const checkPriorities = (given) => {
  const priorities = { ...DEFAULT_PRIORITIES, ...given };
  for (const name of Object.keys(DEFAULT_PRIORITIES)) {
    const value = priorities[name];
    if (!Number.isInteger(value) || value < 1 || value > MAX_PRIORITY) {
      throw new TypeError(`priorities.${name} must be an integer from 1 to ${MAX_PRIORITY}.`);
    }
  }
  return priorities;
};

const createDriverConfig = (options) => {
  const bullmq = options.bullmq;
  const QueueOrInstance = bullmq?.Queue;
  const owned = typeof QueueOrInstance === 'function';
  if (!owned && typeof QueueOrInstance?.add !== 'function') {
    throw new TypeError(
      'createBullMQDriver needs bullmq: { Queue, Worker } of the bullmq package.',
    );
  }
  if (bullmq.Worker !== undefined && typeof bullmq.Worker !== 'function') {
    throw new TypeError('bullmq.Worker must be the Worker class.');
  }
  const detectDuplicates = options.detectDuplicates ?? true;
  if (detectDuplicates !== true && detectDuplicates !== false && detectDuplicates !== 'bulk') {
    throw new TypeError("detectDuplicates must be true, false or 'bulk'.");
  }
  const queueName = options.queueName ?? (owned ? 'mail' : QueueOrInstance.name);
  if (typeof queueName !== 'string' || queueName === '') {
    throw new TypeError('queueName must be a name.');
  }
  return {
    bullmq,
    owned,
    queueName,
    connection: options.connection,
    prefix: options.prefix,
    jobOptions: checkReserved(options.jobOptions, RESERVED_JOB_OPTIONS, 'jobOptions'),
    workerOptions: checkReserved(options.workerOptions, RESERVED_WORKER_OPTIONS, 'workerOptions'),
    priorities: checkPriorities(options.priorities),
    detectDuplicates,
    retainData: checkRetainData(options.retainData),
    // Kept by time, not by count: the window of duplicates does not shrink
    // under load.
    retention: retentionOf(options),
  };
};

const optionsOf = (config, request) => ({
  removeOnComplete: { age: config.retention.dedupeWindowSeconds },
  removeOnFail: { age: config.retention.retainFailedSeconds },
  ...config.jobOptions,
  jobId: request.id,
  timestamp: request.enqueuedAt,
  priority: config.priorities[request.priority] ?? config.priorities.normal,
  delay: request.availableAt === undefined ? 0 : Math.max(0, request.availableAt - Date.now()),
  attempts: request.maxAttempts,
  backoff: { type: MAILER_BACKOFF_TYPE },
});

// Whether BullMQ held a job of the id already: its job then is the first one,
// enqueued at another time.
const duplicateOf = async (queue, request) => {
  const held = await queue.getJob(request.id);
  if (held === undefined || held === null || held.timestamp === request.enqueuedAt) {
    return { id: request.id, duplicate: false };
  }
  const answer = { id: request.id, duplicate: true };
  if (typeof held.data?.hash === 'string') answer.existingHash = held.data.hash;
  return answer;
};

// Tells the audit of a job BullMQ gave up itself, which the handler never
// settled: it may have been sent, by a run that stalled after its send.
const auditLost = async (audit, job, error) => {
  const attempt = Math.max(1, job?.attemptsMade ?? 1);
  const event = {
    id: toUuid(`${job?.id}\u0000${attempt}\u0000delivery_unknown`),
    state: 'delivery_unknown',
    at: new Date().toISOString(),
    source: 'worker',
    correlationId:
      typeof job?.data?.correlationId === 'string' ? job.data.correlationId : String(job?.id),
    jobId: String(job?.id),
    attempt,
    error: {
      category: 'unknown',
      code: 'queue.lost',
      message: redactAddresses(String(error?.message ?? 'lost')).slice(0, 500),
      retryable: false,
    },
  };
  try {
    await audit.append(event);
  } catch (thrown) {
    warnThrown('The audit sink of a BullMQ queue', thrown, 'MAILER_AUDIT_FAILED');
  }
};

const startWorker = (config, queue, handler, consumeOptions, log) => {
  const { Worker } = config.bullmq;
  if (typeof Worker !== 'function') {
    throw new TypeError('A BullMQ driver consumes with bullmq.Worker, which it was not given.');
  }
  const concurrency = checkPositiveInteger(consumeOptions.concurrency ?? 1, 'concurrency');
  const workerOptions = config.workerOptions;
  // A retry of the whole queue needs BullMQ's limiter, which the manual
  // rate limit takes effect through.
  const limited = workerOptions.limiter !== undefined;
  // The queue's rateLimit, or the worker's in a BullMQ that has it there.
  const holder = {};
  const rateLimit = limited
    ? (milliseconds) =>
        typeof queue.rateLimit === 'function'
          ? queue.rateLimit(milliseconds)
          : holder.worker.rateLimit(milliseconds)
    : undefined;
  const processor = createBullMQProcessor(handler, {
    rateLimit,
    signal: consumeOptions.signal,
    retainData: config.retainData,
  });
  const worker = new Worker(config.queueName, processor, {
    ...workerOptions,
    connection: config.connection,
    prefix: config.prefix,
    concurrency,
    settings: {
      ...workerOptions.settings,
      backoffStrategy: createBullMQBackoffStrategy(workerOptions.settings?.backoffStrategy),
    },
  });
  holder.worker = worker;
  worker.on('error', (error) =>
    log.write('error', () => ({ error: error?.message }), 'queue.worker.error'),
  );
  worker.on('failed', (job, error) => {
    // A job BullMQ failed itself, such as one stalled too often, which the
    // handler never saw.
    if (!isSettledError(error)) {
      log.write('error', () => ({ jobId: job?.id, reason: error?.message }), 'queue.job.lost');
      if (typeof consumeOptions.audit?.append === 'function') {
        auditLost(consumeOptions.audit, job, error);
      }
    }
  });
  worker.on('stalled', (jobId) => log.write('warn', () => ({ jobId }), 'queue.job.stalled'));
  const onAbort = () => {
    worker.close().catch(() => {});
  };
  consumeOptions.signal?.addEventListener('abort', onAbort, { once: true });
  return {
    worker,
    async close(closeOptions = {}) {
      consumeOptions.signal?.removeEventListener('abort', onAbort);
      const timeout = closeOptions.timeoutMilliseconds ?? 30_000;
      const closing = worker.close();
      if ((await settledWithin(closing, timeout)) === 'timeout') {
        // The jobs in flight are told to stop: one not yet sent goes back.
        processor.shutdown(new DOMException('The worker closed.', 'AbortError'));
        worker.cancelAllJobs?.('The worker closed.');
        if ((await settledWithin(closing, timeout)) === 'timeout') {
          log.write('warn', () => ({ timeoutMilliseconds: timeout }), 'queue.close_abandoned');
        }
      }
    },
  };
};

/**
 * Makes a queue driver over BullMQ.
 *
 * @param options `bullmq`: `{ Queue, Worker }` of the bullmq package, or
 * `{ Queue: queue }`, a queue of your own, which the driver does not close;
 * `connection`, `prefix`, `queueName` ('mail'); `jobOptions`, such as
 * `removeOnComplete`; `workerOptions`, such as `limiter` or
 * `lockDuration`; `priorities` (`{ high: 1, normal: 2, low: 3 }`);
 * `detectDuplicates` (true); `retainData` ('failed'), the finished jobs whose
 * data is kept; `dedupeWindowSeconds` (a day) and `retainFailedSeconds` (a
 * week), BullMQ's `removeOnComplete` and `removeOnFail`; `logger`.
 * @returns The driver, with `queue` and `createProcessor(handler)`.
 * @throws {TypeError} If an option is invalid.
 */
const createBullMQDriver = (options = {}) => {
  const config = createDriverConfig(options);
  const queue = config.owned
    ? new config.bullmq.Queue(config.queueName, {
        connection: config.connection,
        prefix: config.prefix,
      })
    : config.bullmq.Queue;
  const log = createLog(options.logger, { component: 'queue', queue: config.queueName });
  return {
    id: 'bullmq',
    queue,
    async enqueue(request) {
      await queue.add(request.name, request.data, optionsOf(config, request));
      if (!request.unique) return { id: request.id, duplicate: false };
      if (config.detectDuplicates === false) return { id: request.id, duplicate: undefined };
      return duplicateOf(queue, request);
    },
    async enqueueMany(requests) {
      const jobs = [];
      for (const request of requests) {
        jobs.push({ name: request.name, data: request.data, opts: optionsOf(config, request) });
      }
      await queue.addBulk(jobs);
      const results = [];
      for (const request of requests) {
        if (!request.unique) {
          results.push({ id: request.id, duplicate: false });
        } else if (config.detectDuplicates === 'bulk') {
          results.push(undefined);
        } else {
          results.push({ id: request.id, duplicate: undefined });
        }
      }
      // The jobs read back, so many at once rather than one round trip each.
      for (let start = 0; start < requests.length; start += DUPLICATE_READS) {
        const reads = [];
        const end = Math.min(start + DUPLICATE_READS, requests.length);
        for (let index = start; index < end; index++) {
          if (results[index] === undefined) reads.push(duplicateOf(queue, requests[index]));
        }
        const answers = await Promise.all(reads);
        let next = 0;
        for (let index = start; index < end; index++) {
          if (results[index] === undefined) results[index] = answers[next++];
        }
      }
      return results;
    },
    consume: (handler, consumeOptions = {}) =>
      startWorker(config, queue, handler, consumeOptions, log),
    createProcessor: (handler, processorOptions) =>
      createBullMQProcessor(handler, { retainData: config.retainData, ...processorOptions }),
    async close() {
      if (config.owned) await queue.close();
    },
  };
};

module.exports = { createBullMQDriver };
