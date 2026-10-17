// Ported from upyo v0.7.0 (packages/mailtrap/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { toAsciiAddress } = require('../core/address.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { toBase64 } = require('../internal/base64.js');
const {
  convertAttachments,
  formatAddresses,
  visitCustomHeaders,
  withCalendarAttachment,
} = require('../internal/provider.js');

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

const PRIORITIES = { high: '1', normal: '3', low: '5' };

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

  const attachments = withCalendarAttachment(message);

  const emailData = {
    from: formatAddress(message.sender),
    to: formatAddresses(message.recipients, formatAddress),
    subject: message.subject,
    category: resolveCategory(message.tags, config.defaultCategory),
  };

  if (message.ccRecipients.length > 0) {
    emailData.cc = formatAddresses(message.ccRecipients, formatAddress);
  }

  if (message.bccRecipients.length > 0) {
    emailData.bcc = formatAddresses(message.bccRecipients, formatAddress);
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

  let headers;
  if (message.priority !== 'normal') headers = { 'X-Priority': PRIORITIES[message.priority] };
  visitCustomHeaders(message, isStandardHeader, (name, value) => {
    headers ??= {};
    headers[name] = value;
  });
  if (headers !== undefined) emailData.headers = headers;

  if (attachments.length > 0) {
    emailData.attachments = await convertAttachments(attachments, convertAttachment, signal);
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
    return { email: toAsciiAddress(address.address), name: address.name };
  }
  return { email: toAsciiAddress(address.address) };
};

const convertAttachment = async (attachment, signal) => {
  signal?.throwIfAborted();
  const contentBytes = await readAttachmentContent(attachment.content, signal);
  signal?.throwIfAborted();
  const converted = {
    content: toBase64(contentBytes),
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

const isStandardHeader = (headerName) => {
  return STANDARD_HEADERS.has(headerName.toLowerCase());
};

module.exports = { convertMessage };
