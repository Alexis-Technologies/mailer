// Ported from upyo v0.7.0 (packages/maileroo/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { generateId } = require('../core/id.js');
const { toAsciiAddress } = require('../core/address.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { toBase64 } = require('../internal/base64.js');
const { trackingSwitchOf } = require('../internal/tracking.js');
const {
  convertAttachments,
  formatAddresses,
  visitCustomHeaders,
  withCalendarAttachment,
} = require('../internal/provider.js');
const { RefusalError } = require('../internal/refusal.js');

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
 * @throws {RangeError} If it asks for opens without clicks, or the reverse,
 * or its metadata cannot be tags.
 * @throws {Error} If the caller aborts the operation.
 */
const convertMessage = async (message, config, signal) => {
  signal?.throwIfAborted();

  const attachments = withCalendarAttachment(message);

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

  // One switch for opens and clicks, the message's over the configuration's.
  const tracking = trackingSwitchOf(message.tracking, 'Maileroo') ?? config.tracking;
  if (tracking !== undefined) {
    emailData.tracking = tracking;
  }

  if (message.scheduledAt !== undefined) {
    emailData.scheduled_at = message.scheduledAt.toISOString();
  }

  const tags = convertTags(message, config);
  if (Object.keys(tags).length > 0) {
    emailData.tags = tags;
  }

  const headers = convertHeaders(message);
  if (headers !== undefined) emailData.headers = headers;

  if (attachments.length > 0) {
    emailData.attachments = await convertAttachments(attachments, convertAttachment, signal);
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
    ? { address: toAsciiAddress(address.address) }
    : { address: toAsciiAddress(address.address), display_name: address.name };
};

const convertAddressList = (addresses) => {
  return addresses.length === 1
    ? convertAddress(addresses[0])
    : formatAddresses(addresses, convertAddress);
};

const convertOptionalAddressList = (addresses) => {
  return addresses.length === 0 ? undefined : convertAddressList(addresses);
};

// "Maximum key length is 128 characters, and maximum value length is 768".
const MAX_TAG_VALUE = 768;
const NUMBERED_TAG = /^tag\d+$/;

// The tags of the configuration, the metadata of the message over them, then
// `tag1`… of its tags, which a key of the metadata may not take.
const convertTags = (message, config) => {
  const tags = config.tags == null ? {} : { ...config.tags };

  if (message.metadata !== undefined) {
    for (const key in message.metadata) {
      const value = message.metadata[key];
      if (value.length > MAX_TAG_VALUE || NUMBERED_TAG.test(key)) {
        throw new RefusalError(
          `Maileroo takes metadata as tags, whose value has at most ${MAX_TAG_VALUE} ` +
            `characters and whose name is not tag1, tag2…: ${key}`,
        );
      }
      tags[key] = value;
    }
  }

  for (let index = 0; index < message.tags.length; index++) {
    tags[`tag${index + 1}`] = message.tags[index];
  }

  return tags;
};

// The priority and the custom headers, or `undefined` when there are none.
const convertHeaders = (message) => {
  let headers;
  if (message.priority !== 'normal') headers = { 'X-Priority': PRIORITIES[message.priority] };
  visitCustomHeaders(message, isStandardHeader, (name, value) => {
    headers ??= {};
    headers[name] = value;
  });
  return headers;
};

const PRIORITIES = { high: '1', normal: '3', low: '5' };

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
