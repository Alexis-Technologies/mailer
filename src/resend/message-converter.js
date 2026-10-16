// Ported from upyo v0.7.0 (packages/resend/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { formatMailbox: formatAddress } = require('../core/address.js');
const { createCalendarAttachment } = require('../core/calendar.js');
const { combineSignals } = require('../core/abort-signal.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { resolveThreadingHeaders } = require('../core/message-id.js');
const { toBase64 } = require('../internal/base64.js');
const { lowerCaseNames } = require('../internal/headers.js');

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
  // A transport that cannot compose a `text/calendar` alternative carries the
  // scheduling payload as an *invite.ics* part instead, ahead of the caller's
  // own files so that a client looking for the first calendar part finds it.
  const attachments =
    message.calendar == null
      ? message.attachments
      : [createCalendarAttachment(message.calendar), ...message.attachments];

  const emailData = {
    from: formatAddress(message.sender),
    to:
      message.recipients.length === 1
        ? formatAddress(message.recipients[0])
        : message.recipients.map(formatAddress),
    subject: message.subject,
  };

  // CC recipients
  if (message.ccRecipients.length > 0) {
    emailData.cc = message.ccRecipients.map(formatAddress);
  }

  // BCC recipients
  if (message.bccRecipients.length > 0) {
    emailData.bcc = message.bccRecipients.map(formatAddress);
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
    const cancellation = new AbortController();
    const combined = combineSignals(cancellation.signal, options.signal);
    try {
      emailData.attachments = await Promise.all(
        attachments.map((attachment) => convertAttachment(attachment, combined.signal)),
      );
    } finally {
      cancellation.abort();
      combined.cleanup();
    }
  }

  // Tags - Resend uses different format than Upyo
  if (message.tags.length > 0) {
    emailData.tags = message.tags.map((tag, index) => ({
      name: `tag${index + 1}`, // Resend requires name-value pairs
      value: tag,
    }));
  }

  // Custom headers
  const headers = {};

  // Priority
  if (message.priority !== 'normal') {
    const priorityMap = {
      high: '1',
      normal: '3',
      low: '5',
    };
    headers['X-Priority'] = priorityMap[message.priority];
  }

  // Custom headers from message
  // Reply threading comes from the typed fields when the message defines them,
  // and from a custom header otherwise.  A field the message owns but left
  // empty writes nothing, which is how a caller drops an inherited header.
  const threading = resolveThreadingHeaders(message);
  const ownedHeaders = lowerCaseNames(threading.keys());

  for (const [key, value] of message.headers.entries()) {
    // Skip standard headers that are handled separately
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

  // Scheduled sending
  if (options.scheduledAt) {
    emailData.scheduled_at = options.scheduledAt.toISOString();
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

  const batchData = await Promise.all(messages.map((message) => convertMessage(message, _config)));

  return batchData;
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
 * crypto.randomUUID, since Resend answers a repeated key with the first
 * answer, and two sends sharing a key by chance would lose one of them.
 *
 * @returns A unique string suitable for use as an idempotency key
 */
const generateIdempotencyKey = () => crypto.randomUUID();

module.exports = { convertMessage, convertMessagesBatch, generateIdempotencyKey };
