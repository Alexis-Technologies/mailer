// Ported from upyo v0.7.0 (packages/mailtrap/src/message-converter.ts)
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
 * Converts an Upyo message to Mailtrap API JSON format.
 *
 * @param message The Upyo message to convert.
 * @param config The resolved Mailtrap configuration.
 * @param signal Optional abort signal for cancellation.
 * @returns JSON object ready for Mailtrap API submission.
 * @throws {TypeError} If the message carries an invalid message identifier.
 * @throws {RangeError} If the message has no text or HTML content.
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
    from: formatAddress(message.sender),
    to: message.recipients.map(formatAddress),
    subject: message.subject,
    category: resolveCategory(message.tags, config.defaultCategory),
  };

  if (message.ccRecipients.length > 0) {
    emailData.cc = message.ccRecipients.map(formatAddress);
  }

  if (message.bccRecipients.length > 0) {
    emailData.bcc = message.bccRecipients.map(formatAddress);
  }

  if (message.replyRecipients.length > 0) {
    emailData.reply_to = formatAddress(message.replyRecipients[0]);
  }

  if ('html' in message.content) {
    emailData.html = message.content.html;
    if (message.content.text) {
      emailData.text = message.content.text;
    }
  } else {
    emailData.text = message.content.text;
  }

  if (!emailData.text && !emailData.html) {
    throw new RangeError('Mailtrap requires at least one of text or HTML content.');
  }

  const customVariables = buildCustomVariables(message.tags, config.metadata);
  if (Object.keys(customVariables).length > 0) {
    emailData.custom_variables = customVariables;
  }

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

const resolveCategory = (tags, fallback) => {
  return tags[0] ?? fallback;
};

const buildCustomVariables = (tags, metadata) => {
  const customVariables = {};

  if (metadata != null) {
    for (const [key, value] of Object.entries(metadata)) {
      customVariables[key] = value;
    }
  }

  for (const tag of tags.slice(1)) {
    customVariables[`tag_${tag}`] = tag;
  }

  return customVariables;
};

const formatAddress = (address) => {
  if (address.name) {
    return { email: address.address, name: address.name };
  }
  return { email: address.address };
};

const convertAttachment = async (attachment, signal) => {
  signal?.throwIfAborted();
  const contentBytes = await readAttachmentContent(attachment.content, signal);
  signal?.throwIfAborted();
  const converted = {
    content: uint8ArrayToBase64(contentBytes),
    filename: attachment.filename,
  };

  if (attachment.contentType) {
    converted.type = attachment.contentType;
  }

  if (attachment.inline && attachment.contentId) {
    converted.disposition = 'inline';
    converted.content_id = attachment.contentId;
  } else {
    converted.disposition = 'attachment';
  }

  return converted;
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

  const chunkSize = 0x1000;
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
