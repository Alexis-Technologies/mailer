// Not ported: the mail queue: messages enqueued as jobs of a driver the
// application chooses (BullMQ, a store's outbox, memory), and workers that
// send them through a transport.

const { warnThrown } = require('../internal/callback.js');
const { createLog } = require('../internal/log.js');
const { toUuid } = require('../internal/uuid.js');
const { checkCodec, sealMailJob } = require('./envelope.js');
const { MailQueueError } = require('./errors.js');
const { createMailJobHandler } = require('./handler.js');
const { checkIdSecret, prepareMailJob } = require('./job.js');
const { keyringOf } = require('./signing.js');

const checkDriver = (driver) => {
  if (typeof driver?.enqueue !== 'function' || typeof driver?.consume !== 'function') {
    throw new TypeError('A mail queue needs a driver, with enqueue() and consume().');
  }
  return driver;
};

// The audit event of a first enqueue.
const queuedEventOf = (data, request) => {
  const event = {
    id: toUuid(`${request.id}\u00000\u0000queued`),
    state: 'queued',
    at: new Date(request.enqueuedAt).toISOString(),
    source: 'producer',
    correlationId: data.correlationId,
    jobId: request.id,
    attempt: 0,
    payloadHash: data.hash,
    messageId: data.messageId,
    priority: data.priority,
  };
  if (data.tenantId !== undefined) event.tenantId = data.tenantId;
  if (data.kind === 'template') event.template = data.template;
  if (Array.isArray(data.tags)) event.tags = data.tags;
  return event;
};

// The refusal of keys used before for other messages, with what the other
// jobs of the call gave.
const keyReused = (jobIds, answers) =>
  Object.assign(
    new MailQueueError(
      'queue.key_reused',
      jobIds.length === 1
        ? `The key of job ${jobIds[0]} was used before for another message.`
        : `The keys of ${jobIds.length} jobs were used before for other messages: ${jobIds.join(', ')}.`,
    ),
    { jobIds, answers },
  );

// Tells the sink of a first enqueue. Without a transaction it is told before
// the job is enqueued, so that a strict sink that fails refuses the enqueue
// rather than reports a job enqueued as failed, enqueued again on a retry;
// the event is written once by its id, a duplicate's with it.
const appendQueued = async (queue, { data, request }, transaction) => {
  if (queue.audit === undefined) return;
  try {
    await queue.audit.append(queuedEventOf(data, request), { transaction });
  } catch (error) {
    if (queue.auditStrict) throw error;
    warnThrown('The audit sink of the mail queue', error, 'MAILER_AUDIT_FAILED');
  }
};

// The transaction of an enqueue, refused by a driver that writes none: the
// job would not go with the application's writes, as the caller believes.
const transactionOf = (driver, enqueueOptions) => {
  const { transaction } = enqueueOptions;
  if (transaction === undefined || transaction === null) return undefined;
  if (driver.transactional !== true) {
    throw new TypeError(
      `The ${driver.id} driver writes no transaction: the job would not go with yours.`,
    );
  }
  return transaction;
};

// What an enqueue gives. A first one is told to the sink in the transaction
// of the store when there is one; a job enqueued again is not, and one
// enqueued again for another message is refused.
const afterEnqueue = async (queue, prepared, result, transaction) => {
  const { data, request } = prepared;
  const answer = { id: request.id, correlationId: data.correlationId, messageId: data.messageId };
  if (result?.duplicate === true) {
    if (result.existingHash !== undefined && result.existingHash !== request.hash) {
      throw keyReused([request.id], []);
    }
    queue.log.write('debug', () => ({ jobId: request.id }), 'queue.duplicate');
    return { ...answer, duplicate: true };
  }
  if (transaction !== undefined) await appendQueued(queue, prepared, transaction);
  queue.log.write(
    'debug',
    () => ({ jobId: request.id, priority: request.priority, template: data.template }),
    'queue.enqueued',
  );
  return { ...answer, duplicate: result?.duplicate };
};

// The options of a queue, checked: a bad one fails the queue, not an enqueue.
const createQueueConfig = (options) => {
  const driver = checkDriver(options.driver);
  const { audit } = options;
  if (audit !== undefined && typeof audit?.append !== 'function') {
    throw new TypeError('The audit sink of a mail queue must have append().');
  }
  const auditStrict = options.auditStrict ?? false;
  if (typeof auditStrict !== 'boolean') throw new TypeError('auditStrict must be a boolean.');
  keyringOf(options.signingKeys);
  checkIdSecret(options.idSecret);
  const now = options.now ?? Date.now;
  const jobOptions = {
    namespace: options.namespace,
    maxAttempts: options.maxAttempts,
    maxJobBytes: options.maxJobBytes,
    maxInlineAttachmentBytes: options.maxInlineAttachmentBytes,
    generateId: options.generateId,
    signingKeys: options.signingKeys,
    idSecret: options.idSecret,
    now,
  };
  for (const name of Object.keys(jobOptions)) {
    if (jobOptions[name] === undefined) delete jobOptions[name];
  }
  return {
    driver,
    audit,
    auditStrict,
    codec: checkCodec(options.codec),
    now,
    jobOptions,
    log: createLog(options.logger, { component: 'queue', queue: driver.id }),
  };
};

/**
 * Makes a mail queue over a driver.
 *
 * @param options `driver`; `audit` and `auditStrict`; `namespace` ('mail'),
 * the scope of the keys; `maxAttempts` (5), `maxJobBytes` and
 * `maxInlineAttachmentBytes` (256 KiB); `signingKeys`, which sign each job
 * and which its workers verify; `codec`, which seals the fields of each job
 * in its store and opens them in its workers; `idSecret`, under which the id
 * of a job is derived from its key; `logger`, `generateId`, `now`.
 * @returns `{ driver, enqueue, enqueueMany, createWorker }`.
 * @throws {TypeError} If an option is invalid.
 */
const createMailQueue = (options = {}) => {
  const queue = createQueueConfig(options);
  const { driver, codec } = queue;
  // The job, its data sealed when the queue has a codec: the driver stores
  // the sealed data, the audit reads the clear.
  const prepare = async (input) => {
    const prepared = prepareMailJob(input, queue.jobOptions);
    if (codec === undefined) return prepared;
    const data = await sealMailJob(prepared.data, codec);
    return { data: prepared.data, request: { ...prepared.request, data } };
  };
  return {
    driver,
    async enqueue(input, enqueueOptions = {}) {
      enqueueOptions.signal?.throwIfAborted();
      const transaction = transactionOf(driver, enqueueOptions);
      const prepared = await prepare(input);
      if (transaction === undefined) await appendQueued(queue, prepared, undefined);
      const result = await driver.enqueue(prepared.request, enqueueOptions);
      return afterEnqueue(queue, prepared, result, transaction);
    },
    async enqueueMany(inputs, enqueueOptions = {}) {
      enqueueOptions.signal?.throwIfAborted();
      const transaction = transactionOf(driver, enqueueOptions);
      const prepared = [];
      for (const input of inputs) prepared.push(await prepare(input));
      if (transaction === undefined) {
        for (const job of prepared) await appendQueued(queue, job, undefined);
      }
      let results;
      if (typeof driver.enqueueMany === 'function') {
        const requests = [];
        for (const job of prepared) requests.push(job.request);
        results = await driver.enqueueMany(requests, enqueueOptions);
      } else {
        results = [];
        for (const job of prepared) results.push(await driver.enqueue(job.request, enqueueOptions));
      }
      // Every job the driver took is told to the sink, a key used before for
      // another message refused once all are.
      const answers = [];
      const reused = [];
      for (let index = 0; index < prepared.length; index++) {
        try {
          answers.push(await afterEnqueue(queue, prepared[index], results[index], transaction));
        } catch (error) {
          if (error?.code !== 'queue.key_reused') throw error;
          reused.push(prepared[index].request.id);
        }
      }
      if (reused.length > 0) throw keyReused(reused, answers);
      return answers;
    },
    createWorker(workerOptions = {}) {
      const handler = createMailJobHandler({
        audit: queue.audit,
        auditStrict: queue.auditStrict,
        logger: options.logger,
        now: queue.now,
        signingKeys: options.signingKeys,
        codec,
        ...workerOptions,
      });
      const consumer = driver.consume(handler, {
        concurrency: workerOptions.concurrency,
        signal: workerOptions.signal,
        audit: workerOptions.audit ?? queue.audit,
      });
      return {
        close: (closeOptions) => consumer.close(closeOptions),
        [Symbol.asyncDispose]: () => consumer.close(),
      };
    },
  };
};

module.exports = { createMailQueue };
