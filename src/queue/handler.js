// Not ported: the worker of a mail queue, as one handler any driver runs:
// it reads a job, renders its template (or takes its content), resolves its
// attachments, builds the message, sends it through the transport the
// application composed, and makes of the receipt what the queue does next,
// telling the audit sink each state on the way.

const { Buffer } = require('node:buffer');
const { isAttachment } = require('../core/attachment.js');
const { classifyReceiptError } = require('../core/receipt.js');
const { createMessage } = require('../core/message.js');
const { renderFields } = require('../render/renderer.js');
const { warnThrown } = require('../internal/callback.js');
const { messageOf } = require('../internal/decorator.js');
const { isDeliveryUnknown } = require('../internal/delivery-unknown.js');
const { fingerprintOf } = require('../internal/fingerprint.js');
const { createLog } = require('../internal/log.js');
const { checkOptionalFunction, checkPositiveInteger } = require('../internal/options.js');
const { checkNonNegativeInteger } = require('../internal/queue-options.js');
const { isCallerAbort } = require('../internal/sleep.js');
const { isProgrammerError, receiptOfThrown } = require('../internal/thrown.js');
const { toUuid } = require('../internal/uuid.js');
const { outcomeOfFailure, reasonOf } = require('./outcome.js');
const { checkCodec, openMailJob } = require('./envelope.js');
const { parseMailJob } = require('./parse.js');
const { keyringOf } = require('./signing.js');

const DEFAULT_BACKOFF = Object.freeze({
  baseDelayMilliseconds: 30_000,
  maxDelayMilliseconds: 3_600_000,
  factor: 2,
});
const DEFAULT_OPERATOR_DELAY_MS = 5 * 60_000;
// The runs of a job that may end without settling (its worker killed, its
// event loop blocked) before the job is given up.
const DEFAULT_MAX_REDELIVERIES = 3;
// The errors of a template that fails again the same way.
const TEMPLATE_CODES = new Set(['MAILER_TEMPLATE_NOT_FOUND', 'MAILER_TEMPLATE_RENDER']);
// The jobs this worker cannot read yet, written by a later version or sealed
// for a codec it lacks: they are given back, their attempts not spent, for a
// worker that can, as during a rolling deploy.
const LATER_CODES = new Set(['queue.unsupported_version', 'queue.codec_missing']);
// How long such a job waits for its worker before it is given up: a week,
// the time a failed job is kept.
const MAX_WAIT_FOR_WORKER_MS = 7 * 24 * 60 * 60 * 1000;
const checkBackoff = (given) => {
  const backoff = { ...DEFAULT_BACKOFF, ...given };
  for (const name of ['baseDelayMilliseconds', 'maxDelayMilliseconds']) {
    if (!Number.isFinite(backoff[name]) || backoff[name] < 0) {
      throw new TypeError(`backoff.${name} must be a number of milliseconds.`);
    }
  }
  if (!Number.isFinite(backoff.factor) || backoff.factor < 1) {
    throw new TypeError('backoff.factor must be at least 1.');
  }
  return backoff;
};

const createHandlerConfig = (options = {}) => {
  const { transport, renderer, audit } = options;
  if (typeof transport?.send !== 'function') {
    throw new TypeError('A mail worker needs a transport.');
  }
  if (renderer !== undefined && typeof renderer?.render !== 'function') {
    throw new TypeError('The renderer of a mail worker must have render().');
  }
  if (audit !== undefined && typeof audit?.append !== 'function') {
    throw new TypeError('The audit sink of a mail worker must have append().');
  }
  const rateLimitScope = options.rateLimitScope ?? 'job';
  if (rateLimitScope !== 'job' && rateLimitScope !== 'queue' && rateLimitScope !== 'tenant') {
    throw new TypeError("rateLimitScope must be 'job', 'queue' or 'tenant'.");
  }
  if (options.auditStrict !== undefined && typeof options.auditStrict !== 'boolean') {
    throw new TypeError('auditStrict must be a boolean.');
  }
  const redelivered = options.redelivered ?? 'send';
  if (redelivered !== 'send' && redelivered !== 'delivery_unknown') {
    throw new TypeError("redelivered must be 'send' or 'delivery_unknown'.");
  }
  // Checked now, so that a bad key fails the worker, not each job.
  keyringOf(options.signingKeys);
  return {
    transport,
    renderer,
    audit,
    auditStrict: options.auditStrict ?? false,
    signingKeys: options.signingKeys,
    codec: checkCodec(options.codec),
    resolveAttachment: checkOptionalFunction(options.resolveAttachment, 'resolveAttachment'),
    checkJob: checkOptionalFunction(options.checkJob, 'checkJob'),
    classify: checkOptionalFunction(options.classify, 'classify'),
    backoff: checkBackoff(options.backoff),
    operatorDelayMilliseconds: checkPositiveInteger(
      options.operatorDelayMilliseconds ?? DEFAULT_OPERATOR_DELAY_MS,
      'operatorDelayMilliseconds',
    ),
    rateLimitScope,
    redelivered,
    maxRedeliveries: checkNonNegativeInteger(
      options.maxRedeliveries ?? DEFAULT_MAX_REDELIVERIES,
      'maxRedeliveries',
    ),
    random: checkOptionalFunction(options.random, 'random') ?? Math.random,
    now: checkOptionalFunction(options.now, 'now') ?? Date.now,
    log: createLog(options.logger, { component: 'queue' }),
  };
};

const failureError = (category, code, message) => ({ category, code, message, retryable: false });

// The fields every audit event of a run shares.
const baseAuditOf = (job, data) => {
  const base = {
    source: 'worker',
    correlationId: data.correlationId,
    jobId: job.id,
    payloadHash: data.hash,
    messageId: data.messageId,
    priority: data.priority,
  };
  if (data.tenantId !== undefined) base.tenantId = data.tenantId;
  if (data.kind === 'template') base.template = data.template;
  if (Array.isArray(data.tags) && data.tags.length > 0) base.tags = data.tags;
  if (job.redelivered) base.redelivered = true;
  return base;
};

// The id of the audit event of a state of a run: the same however often it
// is told, so that a run again of an attempt can ask whether it was told.
const eventIdOf = (job, attempt, state) => toUuid(`${job.id}\u0000${attempt}\u0000${state}`);

// Tells the audit sink a state.  A sink that fails is a warning; with
// `auditStrict`, before the message is submitted, it makes the job retried,
// as an attempt is not made unrecorded.
const emit = async (run, state, extra = {}, attempt = run.job.attempt) => {
  const { config, job } = run;
  if (config.audit === undefined) return undefined;
  const event = {
    id: eventIdOf(job, attempt, state),
    state,
    at: new Date(config.now()).toISOString(),
    ...run.base,
    attempt,
    ...extra,
  };
  try {
    await config.audit.append(event);
    return undefined;
  } catch (error) {
    config.log.write(
      'warn',
      () => ({ jobId: job.id, state, code: 'MAILER_AUDIT_FAILED' }),
      'queue.audit.failed',
    );
    warnThrown('The audit sink of the mail queue', error, 'MAILER_AUDIT_FAILED');
    if (!config.auditStrict || (state !== 'rendered' && state !== 'submitted')) return undefined;
    return {
      type: 'retry',
      delayMilliseconds: config.operatorDelayMilliseconds,
      code: 'audit.failed',
      reason: reasonOf(messageOf(error)),
    };
  }
};

const logFailed = (run, code, reason, state) => {
  run.config.log.write(
    'error',
    () => ({
      jobId: run.job.id,
      attempt: run.job.attempt,
      correlationId: run.data.correlationId,
      code,
      state,
      reason,
      durationMs: run.config.now() - run.started,
    }),
    'queue.job.failed',
  );
};

// Fails a job for good, its state `failed` or `delivery_unknown`.
const fail = async (run, code, reason, options = {}) => {
  const state = options.state ?? 'failed';
  const message = reasonOf(reason);
  await emit(run, state, {
    error: options.error ?? failureError(options.category ?? 'validation', code, message),
  });
  logFailed(run, code, message, state);
  return { type: 'fail', code, reason: message };
};

const release = (run, why) => {
  run.config.log.write(
    'warn',
    () => ({ jobId: run.job.id, attempt: run.job.attempt, why }),
    'queue.job.released',
  );
  return { type: 'release' };
};

// What the queue does with a failed receipt, told to the sink and the log.
const settleFailure = async (run, receipt, code) => {
  const { config, job, data } = run;
  const expiresAt = data.expiresAt === undefined ? undefined : Date.parse(data.expiresAt);
  const decided = outcomeOfFailure(receipt, job, { ...config, expiresAt, tenantId: data.tenantId });
  let { outcome } = decided;
  const generic = outcome.code === 'queue.attempts_exhausted' || outcome.code === 'queue.expired';
  if (code !== undefined && !generic) outcome = { ...outcome, code };
  if (outcome.type === 'retry') {
    const retryAt = new Date(config.now() + outcome.delayMilliseconds).toISOString();
    await emit(run, 'queued', { error: decided.error, retryAt }, job.attempt + 1);
    config.log.write(
      'warn',
      () => ({
        jobId: job.id,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
        code: outcome.code,
        delayMilliseconds: outcome.delayMilliseconds,
        scope: outcome.scope,
        durationMs: config.now() - run.started,
      }),
      'queue.job.retrying',
    );
    return outcome;
  }
  await emit(run, decided.state, { error: decided.error });
  logFailed(run, outcome.code, outcome.reason, decided.state);
  return outcome;
};

// A failure thrown by the application's code (a resolver, a renderer's
// loader): a bug fails the job, anything else is classified as a send's is.
const settleThrown = (run, error, code) => {
  if (isProgrammerError(error) || error?.retryable === false || TEMPLATE_CODES.has(error?.code)) {
    const category = classifyReceiptError(error).category;
    return fail(run, code, messageOf(error), {
      error: failureError(
        category === 'unknown' ? 'validation' : category,
        code,
        reasonOf(messageOf(error)),
      ),
    });
  }
  const receipt = receiptOfThrown(error, 'queue');
  if (error?.retryable === true && receipt.retryable !== true) {
    return settleFailure(run, { ...receipt, retryable: true }, code);
  }
  return settleFailure(run, receipt, code);
};

// A template that fails to render tells what a helper or filter threw, an excerpt of
// its source, or a value of the context: none of that goes into the store of
// the queue or the audit, only which template failed and where, the full
// text to the log at debug.
const templateFailureOf = (run, error) => {
  // A template not found names only templates.
  if (error?.code !== 'MAILER_TEMPLATE_RENDER') return error;
  run.config.log.write(
    'debug',
    () => ({ jobId: run.job.id, code: error.code, reason: reasonOf(messageOf(error)) }),
    'queue.render.failed',
  );
  const where = error.phase === undefined ? '' : ` (${error.phase})`;
  const engine = error.engine === undefined ? '' : ` with ${error.engine}`;
  return Object.assign(
    new Error(
      `The template ${JSON.stringify(error.template ?? run.data.template)} failed${where}${engine}.`,
    ),
    { code: error.code, retryable: error.retryable, name: error.name },
  );
};

const renderStep = async (run) => {
  const { config, data } = run;
  if (data.kind === 'content') return { fields: { subject: data.subject, content: data.content } };
  if (config.renderer === undefined) {
    return {
      outcome: await fail(run, 'render.no_renderer', 'The worker has no renderer for a template.', {
        category: 'configuration',
      }),
    };
  }
  let fields;
  try {
    fields = await renderFields(config.renderer, {
      template: data.template,
      context: data.context,
      locale: data.locale,
      tenantId: data.tenantId,
      // A worker that stops stops its render; a renderer may hear it.
      signal: run.signal,
    });
  } catch (error) {
    if (run.signal.aborted) return { outcome: release(run, 'aborted while rendering') };
    return { outcome: await settleThrown(run, templateFailureOf(run, error), 'render.failed') };
  }
  const subject = data.subject ?? fields.subject;
  if (typeof subject !== 'string' || subject === '') {
    return {
      outcome: await fail(
        run,
        'render.no_subject',
        `The template ${data.template} gave no subject, and the job has none.`,
      ),
    };
  }
  return { fields: { subject, content: fields.content } };
};

const isContent = (value) =>
  value instanceof Uint8Array ||
  value instanceof Blob ||
  value instanceof Promise ||
  typeof value === 'function';

const attachmentsStep = async (run) => {
  const { config, data, signal } = run;
  const attachments = [];
  for (const stored of data.attachments ?? []) {
    const { filename, contentType, inline, contentId } = stored;
    const fields = { filename, contentType, inline, contentId };
    if (stored.data !== undefined) {
      attachments.push({ ...fields, content: new Uint8Array(Buffer.from(stored.data, 'base64')) });
      continue;
    }
    if (config.resolveAttachment === undefined) {
      const reason = `The worker has no resolveAttachment for the attachment ${filename}.`;
      return {
        outcome: await fail(run, 'queue.attachment_unresolved', reason, {
          category: 'configuration',
        }),
      };
    }
    let resolved;
    try {
      resolved = await config.resolveAttachment(stored.ref, {
        job: data,
        attachment: fields,
        signal,
      });
    } catch (error) {
      if (signal.aborted) return { outcome: release(run, 'aborted while resolving an attachment') };
      return { outcome: await settleThrown(run, error, 'queue.attachment_failed') };
    }
    const content = isAttachment(resolved) ? resolved.content : resolved;
    if (!isContent(content)) {
      const reason = `resolveAttachment gave no content for the attachment ${filename}.`;
      return { outcome: await fail(run, 'queue.attachment_failed', reason) };
    }
    attachments.push({ ...fields, content });
  }
  return { attachments };
};

const buildMessage = (run, fields, attachments) => {
  const { data, job } = run;
  return createMessage({
    from: data.from,
    to: data.to,
    cc: data.cc,
    bcc: data.bcc,
    replyTo: data.replyTo,
    subject: fields.subject,
    content: fields.content,
    attachments,
    priority: data.priority,
    tags: data.tags,
    headers: data.headers,
    list: data.list,
    // The job's id: scoped to the tenant, of a fixed length, a hash of the
    // key (under `idSecret`, one no address can be found from).
    idempotencyKey: job.id,
    messageId: data.messageId,
    date: data.date === undefined ? undefined : new Date(data.date),
    inReplyTo: data.inReplyTo,
    references: data.references,
    calendar: data.calendar,
    tracking: data.tracking,
    metadata: data.metadata,
  });
};

const sendStep = async (run, message) => {
  const { config, job, signal } = run;
  let receipt;
  try {
    receipt = await config.transport.send(message, { signal });
  } catch (error) {
    if (signal.aborted || isCallerAbort(error, signal)) {
      return fail(run, 'queue.aborted', 'The worker stopped while the message was sent.', {
        state: 'delivery_unknown',
        category: 'unknown',
      });
    }
    if (isDeliveryUnknown(error)) {
      return fail(run, 'delivery_unknown', messageOf(error), {
        state: 'delivery_unknown',
        category: 'unknown',
      });
    }
    if (isProgrammerError(error)) {
      config.log.write(
        'error',
        () => ({ jobId: job.id, stack: error.stack }),
        'queue.worker.error',
      );
      return fail(run, 'queue.thrown', messageOf(error), { category: 'unknown' });
    }
    receipt = receiptOfThrown(error, config.transport.id);
  }
  if (receipt?.successful === true) {
    const result = {
      provider: receipt.provider ?? config.transport.id,
      providerMessageId: receipt.messageId,
    };
    await emit(run, 'accepted', result);
    config.log.write(
      'info',
      () => ({
        jobId: job.id,
        attempt: job.attempt,
        ...result,
        durationMs: config.now() - run.started,
      }),
      'queue.job.completed',
    );
    return { type: 'ack', result };
  }
  if (receipt?.successful !== false) {
    return fail(run, 'queue.invalid_receipt', 'The transport gave no receipt.');
  }
  return settleFailure(run, receipt);
};

// A run again of an attempt whose run before may have sent the message: of
// unknown delivery, rather than sent blindly again, by a transport with no
// idempotency key (SES, SMTP). A sink that tells whether that run submitted
// lets one that died before it be sent; without one, it is not sent.
const sentBefore = async (run) => {
  const { audit } = run.config;
  if (typeof audit?.has === 'function') {
    let submitted;
    try {
      submitted = await audit.has(eventIdOf(run.job, run.job.attempt, 'submitted'));
    } catch {
      submitted = true;
    }
    if (!submitted) return undefined;
  }
  return fail(run, 'queue.redelivered', 'A run before of this attempt may have sent it.', {
    state: 'delivery_unknown',
    category: 'unknown',
  });
};

const isExpired = (run) =>
  run.data.expiresAt !== undefined && run.config.now() > Date.parse(run.data.expiresAt);

const attempt = async (run) => {
  const { config, data, job, signal } = run;
  // A job whose runs keep ending unsettled kills its worker or blocks it: it
  // is given up before it renders, of unknown delivery, as one of those runs
  // may have sent it.
  if ((job.redeliveries ?? 0) > config.maxRedeliveries) {
    return fail(
      run,
      'queue.redelivery_exhausted',
      `${job.redeliveries} runs of the job ended unsettled, more than ${config.maxRedeliveries}.`,
      { state: 'delivery_unknown', category: 'unknown' },
    );
  }
  if (job.redelivered && config.redelivered === 'delivery_unknown') {
    const unknown = await sentBefore(run);
    if (unknown !== undefined) return unknown;
  }
  if (config.checkJob !== undefined) {
    try {
      await config.checkJob(data, job);
    } catch (error) {
      return fail(run, 'queue.refused', messageOf(error));
    }
  }
  if (isExpired(run)) return fail(run, 'queue.expired', 'The job expired before it was sent.');
  if (signal.aborted) return release(run, 'aborted before rendering');
  const rendered = await renderStep(run);
  if (rendered.outcome !== undefined) return rendered.outcome;
  const resolved = await attachmentsStep(run);
  if (resolved.outcome !== undefined) return resolved.outcome;
  let message;
  try {
    message = buildMessage(run, rendered.fields, resolved.attachments);
  } catch (error) {
    return fail(run, 'queue.invalid_message', messageOf(error));
  }
  const stopped = await emit(run, 'rendered', { messageHash: fingerprintOf(message) });
  if (stopped !== undefined) return stopped;
  if (signal.aborted) return release(run, 'aborted before the send');
  const unrecorded = await emit(run, 'submitted');
  if (unrecorded !== undefined) return unrecorded;
  return sendStep(run, message);
};

// Whether a job waiting for a worker that can read it has waited enough: past
// its `expiresAt`, when that can be read, or a week after it was enqueued.
const isOverdue = (config, job) => {
  const now = config.now();
  const expiresAt = typeof job.data?.expiresAt === 'string' ? Date.parse(job.data.expiresAt) : NaN;
  if (Number.isFinite(expiresAt) && now > expiresAt) return true;
  return job.enqueuedAt !== undefined && now - job.enqueuedAt > MAX_WAIT_FOR_WORKER_MS;
};

// What the queue does with a job this worker cannot read.
const unreadOutcome = (config, job, error) => {
  const code = error?.code ?? 'queue.invalid_job';
  const reason = reasonOf(messageOf(error));
  if (LATER_CODES.has(code) && !isOverdue(config, job)) {
    config.log.write(
      'warn',
      () => ({ jobId: job.id, attempt: job.attempt, code }),
      'queue.job.released',
    );
    return { type: 'release', delayMilliseconds: config.operatorDelayMilliseconds };
  }
  // A codec that fails may be an outage of its key: retried, its attempts
  // spent, unless it says the failure is for good (a ciphertext that does not
  // authenticate).
  const retryable =
    code === 'queue.codec_failed' &&
    error.cause?.retryable !== false &&
    job.attempt < job.maxAttempts;
  config.log.write(
    retryable ? 'warn' : 'error',
    () => ({ jobId: job.id, attempt: job.attempt, code }),
    retryable ? 'queue.job.retrying' : 'queue.job.failed',
  );
  if (retryable) {
    return { type: 'retry', delayMilliseconds: config.operatorDelayMilliseconds, code, reason };
  }
  return { type: 'fail', code, reason };
};

const readJob = async (config, job) => {
  try {
    const data = await openMailJob(job.data, config.codec);
    return { data: parseMailJob(data, { signingKeys: config.signingKeys }) };
  } catch (error) {
    return { outcome: unreadOutcome(config, job, error) };
  }
};

/**
 * Makes the handler of mail jobs, for any queue driver.
 *
 * @param options `transport`; `renderer`, for template jobs; `audit`,
 * `auditStrict`; `signingKeys`, when only signed jobs are sent; `codec`,
 * which opens sealed jobs;
 * `resolveAttachment(ref, { job, attachment, signal })`;
 * `checkJob(data, job)`; `classify({ receipt, job })`; `backoff`,
 * `operatorDelayMilliseconds` (5 minutes), `rateLimitScope` ('job'),
 * `maxRedeliveries` (3), `redelivered` ('send');
 * `logger`, `random`, `now`.
 * @returns The handler: `(job, signal) => Promise<QueueOutcome>`, which does
 * not throw.
 * @throws {TypeError} If an option is invalid.
 */
const createMailJobHandler = (options) => {
  const config = createHandlerConfig(options);
  return async (job, signal) => {
    const read = await readJob(config, job);
    if (read.outcome !== undefined) return read.outcome;
    const run = {
      config,
      job,
      data: read.data,
      signal,
      started: config.now(),
      base: baseAuditOf(job, read.data),
    };
    if (job.redelivered) {
      config.log.write(
        'warn',
        () => ({ jobId: job.id, attempt: job.attempt, redeliveries: job.redeliveries }),
        'queue.job.redelivered',
      );
    }
    config.log.write(
      'debug',
      () => ({
        jobId: job.id,
        attempt: job.attempt,
        template: read.data.template,
        priority: read.data.priority,
      }),
      'queue.job.started',
    );
    try {
      return await attempt(run);
    } catch (error) {
      // What escaped the steps: a bug of this worker, or a sink or logger
      // that threw where it is not guarded. Told, not only failed.
      const reason = reasonOf(messageOf(error));
      warnThrown('The mail worker', error, 'MAILER_QUEUE_WORKER_THREW');
      config.log.write('error', () => ({ jobId: job.id, reason }), 'queue.worker.error');
      return { type: 'fail', code: 'queue.thrown', reason };
    }
  };
};

module.exports = { createMailJobHandler };
