// Not ported: a message to send later as the data of a job, JSON only, made
// by the one core every kind of job shares: its key, the id derived from it
// and its correlation id; its schedule, expiry and attempts; either a
// template with its context, rendered by the worker, or content rendered
// already; its hash and signature, bounded in size. The fields of its message
// are made and checked by the strategy of its kind (email-job.js for an
// email, channel-job.js for a message of a channel).

const { Buffer } = require('node:buffer');
const { generateId } = require('../core/id.js');
const { MAX_KEY_LENGTH, checkKey } = require('../internal/message-checks.js');
const { hashJson } = require('../internal/canonical-json.js');
const { toJson } = require('../internal/json.js');
const { deriveJobId } = require('./derive.js');
const { CHANNEL_JOB_VERSION, checkDefaultCountry } = require('./channel-job.js');
const { EMAIL_JOB_NAME, EMAIL_JOB_VERSION } = require('./email-job.js');
const { keyringOf, signJob } = require('./signing.js');
const { isText } = require('./stored.js');
const { strategyOfInput } = require('./strategies.js');

const KINDS = new Set(['template', 'content']);
// What the hash of a job leaves out: when it was enqueued, itself, and what
// is written over it once it is made: the HMAC and its key id, and the trace
// context of the producer.
const UNHASHED = new Set(['enqueuedAt', 'hash', 'mac', 'kid', 'trace']);
const MIN_ID_SECRET_BYTES = 32;
const DEFAULTS = Object.freeze({
  namespace: 'mail',
  maxAttempts: 5,
  maxJobBytes: 256 * 1024,
  maxInlineAttachmentBytes: 256 * 1024,
});

const checkDateField = (value, name) => {
  if (value === undefined) return undefined;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${name} must be a Date.`);
  }
  return value;
};

// What the job renders or sends: a template and its context, or content.
const bodyOf = (input, strategy) => {
  if (input.kind === 'template') {
    if (!isText(input.template, MAX_KEY_LENGTH)) throw new TypeError('template must be a name.');
    const body = { kind: 'template', template: input.template };
    body.context = toJson(input.context ?? {}, 'context');
    if (typeof body.context !== 'object' || body.context === null || Array.isArray(body.context)) {
      throw new TypeError('context must be an object.');
    }
    if (input.locale !== undefined) body.locale = checkKey(input.locale, 'locale');
    return body;
  }
  return strategy.contentBodyOf(input);
};

const correlationIdOf = (input, jobId) => {
  const given = checkKey(input.correlationId, 'correlationId');
  const inMetadata = input.metadata?.correlationId;
  if (given !== undefined && inMetadata !== undefined && given !== inMetadata) {
    throw new TypeError('correlationId and metadata.correlationId differ.');
  }
  return given ?? inMetadata ?? jobId;
};

/**
 * Checks the secret the ids of jobs are derived under: 32 bytes at least.
 *
 * @throws {TypeError} If it is not one.
 * @internal
 */
const checkIdSecret = (secret) => {
  if (secret === undefined) return;
  let bytes = 0;
  if (typeof secret === 'string') bytes = Buffer.byteLength(secret);
  else if (secret instanceof Uint8Array) bytes = secret.byteLength;
  if (bytes < MIN_ID_SECRET_BYTES) {
    throw new TypeError(`idSecret must hold ${MIN_ID_SECRET_BYTES} bytes at least.`);
  }
};

const resolveConfig = (options) => {
  const config = { ...DEFAULTS, ...options };
  for (const name of ['maxAttempts', 'maxJobBytes', 'maxInlineAttachmentBytes']) {
    if (!Number.isInteger(config[name]) || config[name] < 1) {
      throw new TypeError(`${name} must be a positive integer.`);
    }
  }
  if (!isText(config.namespace, 128)) throw new TypeError('namespace must be a short string.');
  checkDefaultCountry(config.defaultCountry);
  config.keyring = keyringOf(config.signingKeys);
  checkIdSecret(config.idSecret);
  if (config.deriveId !== undefined && typeof config.deriveId !== 'function') {
    throw new TypeError('deriveId must be a function.');
  }
  return config;
};

/**
 * Makes the job of a message: its data, as JSON, and the request a queue
 * driver takes.
 *
 * @param input `{ kind: 'template', template, context, locale }` or
 * `{ kind: 'content', subject, content }`, with the fields of a message.
 * @param options `namespace` ('mail'), `generateId`, `now`, `maxAttempts`
 * (5), `maxJobBytes` (256 KiB), `maxInlineAttachmentBytes` (256 KiB);
 * `signingKeys`, whose first key signs the job (`kid`, `mac`); `idSecret`,
 * under which its id is derived from its key; `deriveId(kind, seed)`, which
 * makes its id, and the Message-ID and Content-IDs of a job under a key, of
 * the hash they derive from.
 * @returns `{ data, request }`.
 * @throws {TypeError} If a field is invalid, as `createMessage` finds it, or
 * a signing key or `idSecret`.
 * @throws {RangeError} If the job or its attachments are too large.
 */
const prepareJob = (input, options = {}) => {
  const config = resolveConfig(options);
  if (typeof input !== 'object' || input === null || !KINDS.has(input.kind)) {
    throw new TypeError("A job is { kind: 'template', template } or { kind: 'content', content }.");
  }
  const strategy = strategyOfInput(input);
  const body = bodyOf(input, strategy);
  const tenantId = checkKey(input.tenantId, 'tenantId');
  const keyed = checkKey(input.idempotencyKey, 'idempotencyKey');
  const idempotencyKey = keyed ?? generateId('idempotency-key', config.generateId);
  // Derived from the key, so that the same key is the same job: a UUID of
  // its hash (under `idSecret`, one no key can be found from), or what
  // `deriveId` makes of it.
  const scoped = `${config.namespace}\u0000${tenantId ?? ''}\u0000${idempotencyKey}`;
  const jobId = deriveJobId('job-id', strategy.seedOf(scoped, input), config);
  const correlationId = correlationIdOf(input, jobId);
  const scheduledAt = checkDateField(input.scheduledAt, 'scheduledAt');
  const expiresAt = checkDateField(input.expiresAt, 'expiresAt');
  const maxAttempts = input.maxAttempts ?? config.maxAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('maxAttempts must be a positive integer.');
  }
  // Under a key of the caller's, the identifiers the job makes derive from
  // it, so that the same message enqueued again is the same job; otherwise
  // they are drawn from the generator.
  const idOf = (kind, what) =>
    keyed === undefined
      ? config.generateId
      : () => deriveJobId(kind, `${jobId}\u0000${what}`, config);
  const { head, fields, priority } = strategy.prepare(input, { config, idOf, correlationId });
  const now = (config.now ?? Date.now)();
  const data = { v: strategy.version, ...head, ...body, ...fields };
  data.idempotencyKey = idempotencyKey;
  if (tenantId !== undefined) data.tenantId = tenantId;
  data.correlationId = correlationId;
  if (scheduledAt !== undefined) data.notBefore = scheduledAt.toISOString();
  if (expiresAt !== undefined) data.expiresAt = expiresAt.toISOString();
  data.enqueuedAt = new Date(now).toISOString();
  data.hash = hashJson(data, UNHASHED);
  if (config.keyring !== undefined) signJob(data, config.keyring, UNHASHED);
  const bytes = Buffer.byteLength(JSON.stringify(data));
  if (bytes > config.maxJobBytes) {
    throw new RangeError(`The job holds ${bytes} bytes, more than ${config.maxJobBytes}.`);
  }
  const request = {
    id: jobId,
    name: strategy.nameOf(data),
    data,
    hash: data.hash,
    priority,
    maxAttempts,
    enqueuedAt: now,
    unique: keyed !== undefined,
  };
  if (scheduledAt !== undefined) request.availableAt = scheduledAt.getTime();
  if (tenantId !== undefined) request.tenantId = tenantId;
  return { data, request };
};

module.exports = {
  CHANNEL_JOB_VERSION,
  EMAIL_JOB_NAME,
  EMAIL_JOB_VERSION,
  UNHASHED,
  checkIdSecret,
  prepareJob,
};
