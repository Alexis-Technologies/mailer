// Ported from upyo v0.7.0 (packages/resend/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { generateId } = require('../core/id.js');
const { formatMailbox: formatAddress } = require('../core/address.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { toBase64 } = require('../internal/base64.js');
const {
  convertAttachments,
  formatAddresses,
  visitCustomHeaders,
  withCalendarAttachment,
} = require('../internal/provider.js');

const PRIORITIES = { high: '1', normal: '3', low: '5' };
// The name and value of a Resend tag: "ASCII letters, numbers, underscores,
// or dashes", at most 256 characters.
const TAG_TEXT = /^[A-Za-z0-9_-]{1,256}$/;

// The tags of a message, `tag1`… for its tags and the keys of its metadata,
// which Resend returns in its events.
const tagsOf = (message) => {
  const tags = [];
  const names = new Set();
  for (let index = 0; index < message.tags.length; index++) {
    const name = `tag${index + 1}`;
    names.add(name);
    tags.push({ name, value: message.tags[index] });
  }
  if (message.metadata !== undefined) {
    for (const key in message.metadata) {
      const value = message.metadata[key];
      if (!TAG_TEXT.test(key) || !TAG_TEXT.test(value) || names.has(key)) {
        throw new RangeError(
          `Resend takes metadata as tags, whose name and value are ASCII letters, digits, ` +
            `_ or -, and a name other than those of the tags: ${key}`,
        );
      }
      tags.push({ name: key, value });
    }
  }
  return tags;
};

/**
 * Converts a Upyo Message to Resend API JSON format.
 *
 * This function transforms the standardized Upyo message format into
 * the specific format expected by the Resend API.
 *
 * @param message - The Upyo message to convert
 * @param config - The resolved Resend configuration
 * @param options - Optional conversion options
 * @returns JSON object ready for Resend API submission
 * @throws {TypeError} If the message carries an invalid message identifier.
 * @throws {RangeError} If a key or value of its metadata cannot be a tag.
 *
 * @example
 * ```typescript
 * const emailData = await convertMessage(message, config);
 * const response = await fetch(url, {
 *   method: 'POST',
 *   body: JSON.stringify(emailData),
 *   headers: { 'Content-Type': 'application/json' }
 * });
 * ```
 */
const convertMessage = async (message, _config, options = {}) => {
  const attachments = withCalendarAttachment(message);

  const emailData = {
    from: formatAddress(message.sender),
    to:
      message.recipients.length === 1
        ? formatAddress(message.recipients[0])
        : formatAddresses(message.recipients, formatAddress),
    subject: message.subject,
  };

  // CC recipients
  if (message.ccRecipients.length > 0) {
    emailData.cc = formatAddresses(message.ccRecipients, formatAddress);
  }

  // BCC recipients
  if (message.bccRecipients.length > 0) {
    emailData.bcc = formatAddresses(message.bccRecipients, formatAddress);
  }

  // Reply-to
  if (message.replyRecipients.length > 0) {
    // Resend supports only one reply-to address, so we take the first one
    emailData.reply_to = formatAddress(message.replyRecipients[0]);
  }

  // Content
  if ('html' in message.content) {
    emailData.html = message.content.html;
    if (message.content.text) {
      emailData.text = message.content.text;
    }
  } else {
    emailData.text = message.content.text;
  }

  // Attachments
  if (attachments.length > 0) {
    emailData.attachments = await convertAttachments(
      attachments,
      convertAttachment,
      options.signal,
    );
  }

  // Tags - Resend uses different format than Upyo
  const tags = tagsOf(message);
  if (tags.length > 0) emailData.tags = tags;

  let headers;
  if (message.priority !== 'normal') headers = { 'X-Priority': PRIORITIES[message.priority] };
  visitCustomHeaders(message, isStandardHeader, (name, value) => {
    headers ??= {};
    headers[name] = value;
  });
  if (headers !== undefined) emailData.headers = headers;

  // Scheduled sending
  if (message.scheduledAt !== undefined) {
    emailData.scheduled_at = message.scheduledAt.toISOString();
  }

  return emailData;
};

/**
 * Converts multiple Upyo Messages to Resend batch API format.
 *
 * This function handles the batch conversion with proper validation
 * for Resend's batch API limitations.
 *
 * @param messages - Array of Upyo messages to convert
 * @param config - The resolved Resend configuration
 * @returns Array of JSON objects ready for Resend batch API
 * @throws {TypeError} If a message carries an invalid message identifier.
 */
const convertMessagesBatch = async (messages, _config) => {
  // Resend batch API limitations
  if (messages.length > 100) {
    throw new Error('Resend batch API supports maximum 100 emails per request');
  }

  // Check for unsupported features in batch mode.  A calendar is checked here
  // too: it becomes an attachment during conversion, so reading
  // `message.attachments` alone would let one through the batch API that
  // forbids attachments.
  for (const message of messages) {
    if (message.attachments.length > 0 || message.calendar != null) {
      throw new Error('Attachments are not supported in Resend batch API');
    }
    if (message.tags.length > 0) {
      throw new Error('Tags are not supported in Resend batch API');
    }
  }

  const converting = [];
  for (const message of messages) converting.push(convertMessage(message, _config));
  return await Promise.all(converting);
};

/**
 * Converts a Upyo Attachment to Resend attachment format.
 *
 * @param attachment - The Upyo attachment to convert
 * @returns Resend attachment object
 */
const convertAttachment = async (attachment, signal) => {
  const content = await readAttachmentContent(attachment.content, signal);
  const resendAttachment = {
    filename: attachment.filename,
    content: toBase64(content),
  };

  if (attachment.contentType) {
    resendAttachment.content_type = attachment.contentType;
  }

  return resendAttachment;
};

// Built once, not on every call.
const STANDARD_HEADERS = new Set([
  'from',
  'to',
  'cc',
  'bcc',
  'reply-to',
  'subject',
  'content-type',
  'content-transfer-encoding',
  'mime-version',
  'date',
  'message-id',
]);

/**
 * Checks if a header is a standard email header that should not be prefixed.
 *
 * @param headerName - The header name to check
 * @returns True if the header is a standard header
 */
const isStandardHeader = (headerName) => {
  return STANDARD_HEADERS.has(headerName.toLowerCase());
};

/**
 * Generates a random idempotency key for request deduplication: a UUID from
 * crypto.randomUUID, or what the generator of the application makes, since
 * Resend answers a repeated key with the first answer, and two sends sharing
 * a key by chance would lose one of them.
 *
 * @param generator Optional generator of the application.
 * @returns A unique string suitable for use as an idempotency key
 */
const generateIdempotencyKey = (generator) => generateId('idempotency-key', generator);

module.exports = { convertMessage, convertMessagesBatch, generateIdempotencyKey };
