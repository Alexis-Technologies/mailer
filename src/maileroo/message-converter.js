// Ported from upyo v0.7.0 (packages/maileroo/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { generateId } = require('../core/id.js');
const { createCalendarAttachment } = require('../core/calendar.js');
const { combineSignals } = require('../core/abort-signal.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { resolveThreadingHeaders } = require('../core/message-id.js');
const { toBase64 } = require('../internal/base64.js');
const { lowerCaseNames } = require('../internal/headers.js');

const STANDARD_HEADERS = new Set([
  'from',
  'to',
  'cc',
  'bcc',
  'reply-to',
  'subject',
  'date',
  'message-id',
  'content-type',
  'content-transfer-encoding',
  'mime-version',
  'x-priority',
]);

/**
 * Converts an Upyo message to Maileroo API JSON format.
 *
 * @param message The Upyo message to convert.
 * @param config The resolved Maileroo configuration.
 * @param signal Optional abort signal for cancellation.
 * @returns JSON object ready for Maileroo API submission.
 * @throws {TypeError} If the message carries an invalid message identifier.
 * @throws {Error} If the caller aborts the operation.
 */
const convertMessage = async (message, config, signal) => {
  signal?.throwIfAborted();

  // A transport that cannot compose a `text/calendar` alternative carries the
  // scheduling payload as an *invite.ics* part instead, ahead of the caller's
  // own files so that a client looking for the first calendar part finds it.
  const attachments =
    message.calendar == null
      ? message.attachments
      : [createCalendarAttachment(message.calendar), ...message.attachments];

  const emailData = {
    from: convertAddress(message.sender),
    to: convertAddressList(message.recipients),
    subject: message.subject,
    reference_id: createMailerooReference(message.idempotencyKey, config.generateId),
  };

  signal?.throwIfAborted();

  const cc = convertOptionalAddressList(message.ccRecipients);
  if (cc !== undefined) emailData.cc = cc;

  const bcc = convertOptionalAddressList(message.bccRecipients);
  if (bcc !== undefined) emailData.bcc = bcc;

  const replyTo = convertOptionalAddressList(message.replyRecipients);
  if (replyTo !== undefined) emailData.reply_to = replyTo;

  if ('html' in message.content) {
    emailData.html = message.content.html;
    if (message.content.text !== undefined) {
      emailData.plain = message.content.text;
    }
  } else {
    emailData.plain = message.content.text;
  }

  if (config.tracking !== undefined) {
    emailData.tracking = config.tracking;
  }

  const tags = convertTags(message, config);
  if (Object.keys(tags).length > 0) {
    emailData.tags = tags;
  }

  const headers = convertHeaders(message);
  if (Object.keys(headers).length > 0) {
    emailData.headers = headers;
  }

  if (attachments.length > 0) {
    const cancellation = new AbortController();
    const combined = combineSignals(cancellation.signal, signal);
    try {
      emailData.attachments = await Promise.all(
        attachments.map((attachment) => convertAttachment(attachment, combined.signal)),
      );
    } finally {
      cancellation.abort();
      combined.cleanup();
    }
  }

  signal?.throwIfAborted();

  return emailData;
};

// A reference is 24 hexadecimal digits: random ones, or the hash of the key of
// the message or of the one the generator of the application makes.
const createMailerooReference = (idempotencyKey, generator) => {
  if (idempotencyKey != null && idempotencyKey !== '') return hashReference(idempotencyKey);
  if (generator != null) return hashReference(generateId('idempotency-key', generator));
  return crypto.getRandomValues(Buffer.allocUnsafe(12)).toString('hex');
};

// Three 32-bit FNV-1a hashes of the key with different seeds, updated together
// in a single pass over its UTF-8 bytes.
const hashReference = (value) => {
  const bytes = Buffer.from(value, 'utf8');
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  let third = 0x85ebca6b;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    first = Math.imul(first ^ byte, 0x01000193);
    second = Math.imul(second ^ byte, 0x01000193);
    third = Math.imul(third ^ byte, 0x01000193);
  }
  const digest = Buffer.allocUnsafe(12);
  digest.writeUInt32BE(first >>> 0, 0);
  digest.writeUInt32BE(second >>> 0, 4);
  digest.writeUInt32BE(third >>> 0, 8);
  return digest.toString('hex');
};

const convertAddress = (address) => {
  return address.name == null || address.name === ''
    ? { address: address.address }
    : { address: address.address, display_name: address.name };
};

const convertAddressList = (addresses) => {
  const converted = addresses.map(convertAddress);
  return converted.length === 1 ? converted[0] : converted;
};

const convertOptionalAddressList = (addresses) => {
  return addresses.length === 0 ? undefined : convertAddressList(addresses);
};

const convertTags = (message, config) => {
  const tags = config.tags == null ? {} : { ...config.tags };

  for (const [index, tag] of message.tags.entries()) {
    tags[`tag${index + 1}`] = tag;
  }

  return tags;
};

const convertHeaders = (message) => {
  const headers = {};

  if (message.priority !== 'normal') {
    const priorityMap = {
      high: '1',
      normal: '3',
      low: '5',
    };
    headers['X-Priority'] = priorityMap[message.priority];
  }

  // Reply threading comes from the typed fields when the message defines them,
  // and from a custom header otherwise.  A field the message owns but left
  // empty writes nothing, which is how a caller drops an inherited header.
  const threading = resolveThreadingHeaders(message);
  const ownedHeaders = lowerCaseNames(threading.keys());

  for (const [key, value] of message.headers.entries()) {
    if (!isStandardHeader(key) && !ownedHeaders.has(key.toLowerCase())) {
      headers[key] = value;
    }
  }
  for (const [name, value] of threading) {
    if (value != null) headers[name] = value;
  }

  return headers;
};

const convertAttachment = async (attachment, signal) => {
  signal?.throwIfAborted();
  const content = await readAttachmentContent(attachment.content, signal);
  signal?.throwIfAborted();
  return {
    file_name: getAttachmentFileName(attachment),
    content_type: attachment.contentType,
    content: toBase64(content),
    inline: attachment.inline || undefined,
  };
};

const getAttachmentFileName = (attachment) => {
  return attachment.inline &&
    typeof attachment.contentId === 'string' &&
    attachment.contentId !== ''
    ? attachment.contentId
    : attachment.filename;
};

const isStandardHeader = (headerName) => {
  return STANDARD_HEADERS.has(headerName.toLowerCase());
};

module.exports = { convertMessage };
