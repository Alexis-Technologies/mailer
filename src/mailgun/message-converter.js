// Ported from upyo v0.7.0 (packages/mailgun/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { formatQuotedMailbox: formatAddress } = require('../core/address.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { visitCustomHeaders, withCalendarAttachment } = require('../internal/provider.js');
const { refuseScheduledAt } = require('../internal/schedule.js');

const PRIORITIES = { high: '1', normal: '3', low: '5' };

/**
 * Converts a Upyo Message to Mailgun API FormData format.
 *
 * This function transforms the standardized Upyo message format into
 * the specific format expected by the Mailgun API.
 *
 * @param message - The Upyo message to convert
 * @param config - The resolved Mailgun configuration
 * @returns FormData object ready for Mailgun API submission
 * @throws {TypeError} If the message carries an invalid message identifier.
 *
 * @example
 * ```typescript
 * const formData = await convertMessage(message, config);
 * const response = await fetch(url, { method: 'POST', body: formData });
 * ```
 */
const convertMessage = async (message, config, signal) => {
  refuseScheduledAt(message, 'mailgun');
  const formData = new FormData();
  const attachments = withCalendarAttachment(message);

  // Required fields
  formData.append('from', formatAddress(message.sender));

  // Recipients
  for (const recipient of message.recipients) {
    formData.append('to', formatAddress(recipient));
  }

  // CC recipients
  for (const ccRecipient of message.ccRecipients) {
    formData.append('cc', formatAddress(ccRecipient));
  }

  // BCC recipients
  for (const bccRecipient of message.bccRecipients) {
    formData.append('bcc', formatAddress(bccRecipient));
  }

  // Reply-to
  if (message.replyRecipients.length > 0) {
    let replyTo = '';
    for (const recipient of message.replyRecipients) {
      replyTo += `${replyTo === '' ? '' : ', '}${formatAddress(recipient)}`;
    }
    formData.append('h:Reply-To', replyTo);
  }

  // Subject
  formData.append('subject', message.subject);

  // Content
  if ('html' in message.content) {
    formData.append('html', message.content.html);
    if (message.content.text) {
      formData.append('text', message.content.text);
    }
  } else {
    formData.append('text', message.content.text);
  }

  // Priority
  if (message.priority !== 'normal') {
    formData.append('h:X-Priority', PRIORITIES[message.priority]);
  }

  // Tags
  for (const tag of message.tags) {
    formData.append('o:tag', tag);
  }

  visitCustomHeaders(message, isStandardHeader, (name, value) => {
    formData.append(`h:${name}`, value);
  });

  // Attachments
  for (const attachment of attachments) {
    await appendAttachment(formData, attachment, signal);
  }

  // Tracking options
  if (config.tracking !== undefined) {
    formData.append('o:tracking', config.tracking ? 'yes' : 'no');
  }

  if (config.clickTracking !== undefined) {
    formData.append('o:tracking-clicks', config.clickTracking ? 'yes' : 'no');
  }

  if (config.openTracking !== undefined) {
    formData.append('o:tracking-opens', config.openTracking ? 'yes' : 'no');
  }

  return formData;
};

/**
 * Appends an attachment to the FormData.
 *
 * @param formData - The FormData to append to
 * @param attachment - The attachment to append
 */
const appendAttachment = async (formData, attachment, signal) => {
  const content = await readAttachmentContent(attachment.content, signal);
  // Ensure ArrayBuffer type compatibility for Blob constructor
  const buffer =
    content.buffer instanceof ArrayBuffer
      ? content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength)
      : content.slice(); // fallback to create new Uint8Array if SharedArrayBuffer
  const blob = new Blob([buffer], {
    type: attachment.contentType,
  });

  if (attachment.contentId) {
    // Mailgun gives an inline part the file name it is sent under as its
    // Content-ID, so it goes under the ID the HTML refers to by cid:.
    formData.append('inline', blob, attachment.contentId);
  } else {
    // Regular attachment
    formData.append('attachment', blob, attachment.filename);
  }
};

// Built once, not on every call.
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
]);

/**
 * Checks if a header is a standard email header that should not be prefixed with 'h:'.
 *
 * @param headerName - The header name to check
 * @returns True if it's a standard header
 */
const isStandardHeader = (headerName) => {
  return STANDARD_HEADERS.has(headerName.toLowerCase());
};

module.exports = { convertMessage };
