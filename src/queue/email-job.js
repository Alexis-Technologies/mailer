// Not ported: the strategy of an email job, version 1, the job of 1.2 byte
// for byte: its fields checked by `createMessage` when it is enqueued, so
// that a bad address fails the caller rather than the worker; its
// Message-ID and Content-IDs fixed then, so that every attempt sends the same
// message; its shape checked again when a worker reads it; and the message a
// worker builds of it.

const { isAttachment } = require('../core/attachment.js');
const { generateId } = require('../core/id.js');
const { createMessage } = require('../core/message.js');
const { generateSenderMessageId } = require('../core/message-id.js');
const { parseAddress } = require('../core/address.js');
const { invalidJob: invalid } = require('./errors.js');
const { isContent, isObject, isText, storeBytes } = require('./stored.js');

const EMAIL_JOB_VERSION = 1;
const EMAIL_JOB_NAME = 'mail';
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
  const counter = { bytes: 0 };
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
      `${generateId('content-id', idOf('content-id', `content-id\u0000${attachments.length}`))}@${domainOf(sender)}`;
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
      stored.data = storeBytes(content, counter, config, 'attachments');
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

const checkAddress = (value, name) => {
  if (!isObject(value) || typeof value.address !== 'string') {
    throw invalid(`${name} is no address.`);
  }
};

const checkAddresses = (value, name, required) => {
  if (value === undefined && !required) return;
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw invalid(`${name} is no list of addresses.`);
  }
  for (const address of value) checkAddress(address, name);
};

const checkAttachments = (attachments) => {
  if (attachments === undefined) return;
  if (!Array.isArray(attachments)) throw invalid('attachments is no list.');
  for (const attachment of attachments) {
    if (
      !isObject(attachment) ||
      typeof attachment.filename !== 'string' ||
      typeof attachment.contentType !== 'string' ||
      typeof attachment.contentId !== 'string' ||
      typeof attachment.inline !== 'boolean' ||
      (typeof attachment.data === 'string') === (typeof attachment.ref === 'string')
    ) {
      throw invalid(
        'an attachment is not { filename, contentType, inline, contentId, data | ref }.',
      );
    }
  }
};

/**
 * The strategy of an email job.
 *
 * @internal
 */
const emailJob = {
  version: EMAIL_JOB_VERSION,
  keys: V1_KEYS,
  /** The strings of the data beyond those of every job, and those it needs. */
  strings: ['messageId', 'subject', 'date'],
  required: ['messageId'],
  /** What is stored and resolved of the message apart from its fields. */
  part: 'attachment',

  /** The seed of the id of a job of this key. */
  seedOf: (scoped) => scoped,

  /** The fields a job of content adds to its kind, checked. */
  contentBodyOf(input) {
    if (typeof input.subject !== 'string') {
      throw new TypeError('A job of content needs its subject.');
    }
    return { kind: 'content', content: checkContent(input.content) };
  },

  /**
   * The fields of the message of a job, checked as `createMessage` checks
   * them, with its Message-ID and Content-IDs fixed.
   *
   * @param input The input of the job.
   * @param context `config`, `idOf(kind, what)` and the `correlationId`.
   * @returns `{ head, fields, priority }`.
   */
  prepare(input, context) {
    const { config, idOf, correlationId } = context;
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
      probe.messageId ??
      generateSenderMessageId(probe.sender.address, idOf('message-id', 'message-id'));
    return {
      head: {},
      fields: fieldsOf(input, probe, attachments, messageId),
      priority: probe.priority,
    };
  },

  nameOf: () => EMAIL_JOB_NAME,

  /** What an enqueue and every audit event of the job tell beside its id. */
  describe: (data) => ({ messageId: data.messageId }),

  /** Checks what is the job's own of its data as read from its queue. */
  check(data) {
    if (data.kind === 'content' && (typeof data.subject !== 'string' || !isObject(data.content))) {
      throw invalid('a content job has no subject or content.');
    }
    checkAddress(data.from, 'from');
    checkAddresses(data.to, 'to', true);
    checkAddresses(data.cc, 'cc', false);
    checkAddresses(data.bcc, 'bcc', false);
    checkAddresses(data.replyTo, 'replyTo', false);
    checkAttachments(data.attachments);
  },

  /** The rendered fields of a job of content. */
  contentOf: (data) => ({ subject: data.subject, content: data.content }),

  /**
   * The rendered fields of a template job, or why it cannot be sent:
   * `{ failure: { code, reason } }`.
   */
  renderedOf(data, fields) {
    const subject = data.subject ?? fields.subject;
    if (typeof subject !== 'string' || subject === '') {
      return {
        failure: {
          code: 'render.no_subject',
          reason: `The template ${data.template} gave no subject, and the job has none.`,
        },
      };
    }
    return { fields: { subject, content: fields.content } };
  },

  /** What is stored of the message apart from its fields. */
  partsOf: (data) => data.attachments,

  /** A part as the resolver is told it, without its content. */
  partFieldsOf: (stored) => ({
    filename: stored.filename,
    contentType: stored.contentType,
    inline: stored.inline,
    contentId: stored.contentId,
  }),

  describePart: (fields) => `the attachment ${fields.filename}`,

  /** The part of a resolver's answer: an attachment, or its content. */
  resolvedOf: (fields, resolved) => {
    const content = isAttachment(resolved) ? resolved.content : resolved;
    return isContent(content) ? { ...fields, content } : undefined;
  },

  /**
   * The message of a job.
   *
   * @param data The data of the job.
   * @param fields Its rendered fields.
   * @param parts Its attachments, resolved.
   * @param job The run of the job.
   */
  build: (data, fields, parts, job) =>
    createMessage({
      from: data.from,
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      replyTo: data.replyTo,
      subject: fields.subject,
      content: fields.content,
      attachments: parts,
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
    }),
};

module.exports = { EMAIL_JOB_NAME, EMAIL_JOB_VERSION, emailJob };
