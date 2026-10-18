// Not ported: a message to send later as the data of a job, JSON only: its
// fields checked by `createMessage` when it is enqueued, so that a bad address
// fails the caller rather than the worker; its Message-ID, Content-IDs and
// key fixed then, so that every attempt sends the same message; and either a
// template with its context, rendered by the worker, or content rendered
// already.

const { Buffer } = require('node:buffer');
const { generateId } = require('../core/id.js');
const { createMessage } = require('../core/message.js');
const { generateSenderMessageId } = require('../core/message-id.js');
const { parseAddress } = require('../core/address.js');
const { toBase64 } = require('../internal/base64.js');
const { toKeyedUuid, toUuid } = require('../internal/uuid.js');
const { hashJson } = require('./hash.js');
const { toJson } = require('./json.js');
const { keyringOf, signJob } = require('./signing.js');

const MAIL_JOB_VERSION = 1;
const MAIL_JOB_NAME = 'mail';
const KINDS = new Set(['template', 'content']);
// What the hash of a job leaves out: when it was enqueued, itself, and what
// is written over it once it is made: the HMAC and its key id, and the trace
// context of the producer.
const UNHASHED = new Set(['enqueuedAt', 'hash', 'mac', 'kid', 'trace']);
// The fields of a job of version 1. A field beyond them was written by a
// later version, whose worker reads it: a job here does not fail its hash for
// it, it waits (see parse.js). A field more is a new version.
const V1_KEYS = new Set([
  'v',
  'kind',
  'template',
  'context',
  'locale',
  'subject',
  'content',
  'from',
  'to',
  'cc',
  'bcc',
  'replyTo',
  'attachments',
  'priority',
  'tags',
  'headers',
  'list',
  'messageId',
  'date',
  'inReplyTo',
  'references',
  'calendar',
  'tracking',
  'metadata',
  'idempotencyKey',
  'tenantId',
  'correlationId',
  'notBefore',
  'expiresAt',
  'enqueuedAt',
  'hash',
  'mac',
  'kid',
  'trace',
]);
const MAX_KEY_LENGTH = 256;
const MIN_ID_SECRET_BYTES = 32;
const DEFAULTS = Object.freeze({
  namespace: 'mail',
  maxAttempts: 5,
  maxJobBytes: 256 * 1024,
  maxInlineAttachmentBytes: 256 * 1024,
});

const isText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;

const hasControl = (text) => {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

const checkKey = (value, name) => {
  if (value === undefined) return undefined;
  if (!isText(value, MAX_KEY_LENGTH) || hasControl(value)) {
    throw new TypeError(`${name} must be a string of 1 to ${MAX_KEY_LENGTH} characters.`);
  }
  return value;
};

const checkDateField = (value, name) => {
  if (value === undefined) return undefined;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${name} must be a Date.`);
  }
  return value;
};

const addressOf = (address) =>
  address.name == null
    ? { address: address.address }
    : { name: address.name, address: address.address };

const addressesOf = (addresses) => {
  const list = [];
  for (const address of addresses) list.push(addressOf(address));
  return list;
};

const domainOf = (address) => address.slice(address.lastIndexOf('@') + 1) || 'localhost';

// The attachments of a job: their bytes in base64, bounded, or a reference
// the worker resolves; and the stand-ins `createMessage` checks them by.
const prepareAttachments = (given, sender, config, idOf) => {
  if (given === undefined) return { attachments: undefined, probes: [] };
  if (!Array.isArray(given)) throw new TypeError('attachments must be an array.');
  const attachments = [];
  const probes = [];
  let inlineBytes = 0;
  for (const attachment of given) {
    if (typeof attachment !== 'object' || attachment === null) {
      throw new TypeError('An attachment of a job is { filename, content } or { filename, ref }.');
    }
    const { filename, content, ref } = attachment;
    if (!isText(filename, 1024)) throw new TypeError('An attachment of a job needs its filename.');
    const contentType = attachment.contentType ?? 'application/octet-stream';
    const inline = attachment.inline ?? false;
    const contentId =
      attachment.contentId ??
      `${generateId('content-id', idOf(`content-id\u0000${attachments.length}`))}@${domainOf(sender)}`;
    if (
      typeof contentType !== 'string' ||
      typeof inline !== 'boolean' ||
      typeof contentId !== 'string'
    ) {
      throw new TypeError(
        `The attachment ${filename} has an invalid contentType, inline or contentId.`,
      );
    }
    const stored = { filename, contentType, inline, contentId };
    if (content instanceof Uint8Array && ref === undefined) {
      inlineBytes += content.byteLength;
      if (inlineBytes > config.maxInlineAttachmentBytes) {
        throw new RangeError(
          `The attachments of a job hold more than ${config.maxInlineAttachmentBytes} bytes; ` +
            'give larger ones as { ref }, resolved by the worker.',
        );
      }
      stored.data = toBase64(content);
    } else if (typeof ref === 'string' && ref !== '' && content === undefined) {
      stored.ref = ref;
    } else {
      throw new TypeError(`The attachment ${filename} needs content as bytes, or a ref.`);
    }
    attachments.push(stored);
    probes.push({ filename, contentType, inline, contentId, content: new Uint8Array(0) });
  }
  return { attachments, probes };
};

const checkContent = (content) => {
  const html = content?.html;
  const text = content?.text;
  if (
    (html !== undefined && typeof html !== 'string') ||
    (text !== undefined && typeof text !== 'string') ||
    (html === undefined && text === undefined)
  ) {
    throw new TypeError('The content of a job is { html, text }, one of them at least.');
  }
  if (html === undefined) return { text };
  return text === undefined ? { html } : { html, text };
};

// What the job renders or sends: a template and its context, or content.
const bodyOf = (input) => {
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
  if (typeof input.subject !== 'string') throw new TypeError('A job of content needs its subject.');
  return { kind: 'content', content: checkContent(input.content) };
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
  config.keyring = keyringOf(config.signingKeys);
  checkIdSecret(config.idSecret);
  return config;
};

// The fields of the message as `createMessage` checked them, as JSON.
const fieldsOf = (input, probe, attachments, messageId) => {
  const fields = { from: addressOf(probe.sender), to: addressesOf(probe.recipients) };
  if (probe.ccRecipients.length > 0) fields.cc = addressesOf(probe.ccRecipients);
  if (probe.bccRecipients.length > 0) fields.bcc = addressesOf(probe.bccRecipients);
  if (probe.replyRecipients.length > 0) fields.replyTo = addressesOf(probe.replyRecipients);
  if (input.subject !== undefined) fields.subject = input.subject;
  if (attachments !== undefined && attachments.length > 0) fields.attachments = attachments;
  fields.priority = probe.priority;
  if (probe.tags.length > 0) fields.tags = [...probe.tags];
  if (input.headers !== undefined) {
    fields.headers = {};
    for (const [name, value] of new Headers(input.headers)) fields.headers[name] = value;
  }
  if (input.list !== undefined) fields.list = JSON.parse(JSON.stringify(input.list));
  fields.messageId = messageId;
  if (probe.date !== undefined) fields.date = probe.date.toISOString();
  if (probe.inReplyTo !== undefined) fields.inReplyTo = [...probe.inReplyTo];
  if (probe.references !== undefined) fields.references = [...probe.references];
  if (probe.calendar !== undefined) fields.calendar = { ...probe.calendar };
  if (probe.tracking !== undefined) fields.tracking = { ...probe.tracking };
  fields.metadata = { ...probe.metadata };
  return fields;
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
 * under which its id is derived from its key.
 * @returns `{ data, request }`.
 * @throws {TypeError} If a field is invalid, as `createMessage` finds it, or
 * a signing key or `idSecret`.
 * @throws {RangeError} If the job or its attachments are too large.
 */
const prepareMailJob = (input, options = {}) => {
  const config = resolveConfig(options);
  if (typeof input !== 'object' || input === null || !KINDS.has(input.kind)) {
    throw new TypeError("A job is { kind: 'template', template } or { kind: 'content', content }.");
  }
  const body = bodyOf(input);
  const tenantId = checkKey(input.tenantId, 'tenantId');
  const keyed = checkKey(input.idempotencyKey, 'idempotencyKey');
  const idempotencyKey = keyed ?? generateId('idempotency-key', config.generateId);
  // A UUID of the key: under `idSecret`, one that cannot be traced back to a
  // key that names a person.
  const scoped = `${config.namespace}\u0000${tenantId ?? ''}\u0000${idempotencyKey}`;
  const jobId =
    config.idSecret === undefined ? toUuid(scoped) : toKeyedUuid(scoped, config.idSecret);
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
  const idOf = (what) =>
    keyed === undefined ? config.generateId : () => toUuid(`${jobId}\u0000${what}`);
  const sender = typeof input.from === 'string' ? parseAddress(input.from) : input.from;
  const { attachments, probes } = prepareAttachments(
    input.attachments,
    String(sender?.address ?? ''),
    config,
    idOf,
  );
  const probe = createMessage({
    ...input,
    subject: input.subject ?? '',
    content: { text: '' },
    attachments: probes,
    scheduledAt: undefined,
    metadata: { ...input.metadata, correlationId },
  });
  if (probe.headers.has('message-id')) {
    throw new TypeError('A job takes its Message-ID as messageId, not as a header field.');
  }
  const messageId =
    probe.messageId ?? generateSenderMessageId(probe.sender.address, idOf('message-id'));
  const now = (config.now ?? Date.now)();
  const data = { v: MAIL_JOB_VERSION, ...body, ...fieldsOf(input, probe, attachments, messageId) };
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
    name: MAIL_JOB_NAME,
    data,
    hash: data.hash,
    priority: probe.priority,
    maxAttempts,
    enqueuedAt: now,
    unique: keyed !== undefined,
  };
  if (scheduledAt !== undefined) request.availableAt = scheduledAt.getTime();
  return { data, request };
};

module.exports = {
  MAIL_JOB_NAME,
  MAIL_JOB_VERSION,
  UNHASHED,
  V1_KEYS,
  checkIdSecret,
  prepareMailJob,
};
