// Ported from upyo v0.7.0 (packages/maileroo/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createCalendarAttachment } = require('../core/calendar.js');
const { combineSignals } = require('../core/abort-signal.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { resolveThreadingHeaders } = require('../core/message-id.js');

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
    reference_id: createMailerooReference(message.idempotencyKey),
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

const createMailerooReference = (idempotencyKey) => {
  if (idempotencyKey == null || idempotencyKey === '') {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }

  return hashReference(idempotencyKey);
};

const bytesToHex = (bytes) => {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const hashReference = (value) => {
  const bytes = new TextEncoder().encode(value);
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b];

  return seeds
    .map((seed) => {
      let hash = seed;
      for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    })
    .join('');
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
  const ownedHeaders = new Set([...threading.keys()].map((name) => name.toLowerCase()));

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
    content: uint8ArrayToBase64(content),
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

const uint8ArrayToBase64 = (bytes) => {
  const nativeToBase64 = getNativeToBase64(bytes);
  if (nativeToBase64 != null) {
    return nativeToBase64();
  }

  const bufferBase64 = getBufferBase64(bytes);
  if (bufferBase64 != null) {
    return bufferBase64;
  }

  const chunkSize = 4096;
  const chunks = [];

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }

  return btoa(chunks.join(''));
};

const getNativeToBase64 = (bytes) => {
  const candidate = bytes;
  const toBase64 = candidate.toBase64;
  if (typeof toBase64 !== 'function') return undefined;
  return () => toBase64.call(bytes);
};

const getBufferBase64 = (bytes) => {
  const candidate = globalThis.Buffer;
  if (typeof candidate?.from !== 'function') return undefined;

  try {
    const buffer = candidate.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (buffer == null || typeof buffer.toString !== 'function') {
      return undefined;
    }
    const base64 = buffer.toString('base64');
    return typeof base64 === 'string' ? base64 : undefined;
  } catch {
    return undefined;
  }
};

const isStandardHeader = (headerName) => {
  return STANDARD_HEADERS.has(headerName.toLowerCase());
};

module.exports = { convertMessage };
