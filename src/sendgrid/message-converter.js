// Ported from upyo v0.7.0 (packages/sendgrid/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { toAsciiAddress } = require('../core/address.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { toBase64 } = require('../internal/base64.js');
const {
  collectCustomHeaders,
  convertAttachments,
  formatAddresses,
  withCalendarAttachment,
} = require('../internal/provider.js');

/**
 * Converts a Upyo Message to SendGrid API JSON format.
 *
 * This function transforms the standardized Upyo message format into
 * the specific format expected by the SendGrid API.
 *
 * @param message - The Upyo message to convert
 * @param config - The resolved SendGrid configuration
 * @returns Promise that resolves to a SendGrid mail object
 * @throws {TypeError} If the message carries an invalid message identifier.
 *
 * @example
 * ```typescript
 * const mailData = await convertMessage(message, config);
 * const response = await httpClient.sendMessage(mailData);
 * ```
 */
const convertMessage = async (message, config, signal) => {
  const attachments = withCalendarAttachment(message);
  const personalization = {
    to: formatAddresses(message.recipients, formatAddress),
    subject: message.subject,
  };
  if (message.ccRecipients.length > 0) {
    personalization.cc = formatAddresses(message.ccRecipients, formatAddress);
  }
  if (message.bccRecipients.length > 0) {
    personalization.bcc = formatAddresses(message.bccRecipients, formatAddress);
  }
  const sendGridMail = {
    personalizations: [personalization],
    from: formatAddress(message.sender),
  };

  if (message.replyRecipients.length === 1) {
    sendGridMail.reply_to = formatAddress(message.replyRecipients[0]);
  } else if (message.replyRecipients.length > 1) {
    sendGridMail.reply_to_list = formatAddresses(message.replyRecipients, formatAddress);
  }

  sendGridMail.content = contentOf(message);

  // Priority goes in custom headers, then the caller's own.
  if (message.priority !== 'normal') {
    sendGridMail.headers = { ...sendGridMail.headers, ...PRIORITY_HEADERS[message.priority] };
  }
  if (message.tags.length > 0) {
    // Categories in SendGrid.
    sendGridMail.categories = [...message.tags];
  }
  const customHeaders = collectCustomHeaders(message, isStandardHeader);
  if (customHeaders !== undefined) {
    sendGridMail.headers = { ...sendGridMail.headers, ...customHeaders };
  }

  if (attachments.length > 0) {
    sendGridMail.attachments = await convertAttachments(attachments, convertAttachment, signal);
  }

  const trackingSettings = trackingSettingsOf(config);
  if (trackingSettings !== undefined) sendGridMail.tracking_settings = trackingSettings;

  return sendGridMail;
};

const PRIORITY_HEADERS = {
  high: { 'X-Priority': '1', 'X-MSMail-Priority': 'High', Importance: 'High' },
  low: { 'X-Priority': '5', 'X-MSMail-Priority': 'Low', Importance: 'Low' },
};

// The plain text part, unless the message has only HTML, then the HTML part.
const contentOf = (message) => {
  if (!('html' in message.content)) {
    return [{ type: 'text/plain', value: message.content.text }];
  }
  const content = [];
  if (message.content.text) content.push({ type: 'text/plain', value: message.content.text });
  content.push({ type: 'text/html', value: message.content.html });
  return content;
};

// The tracking settings the configuration sets, or `undefined` for none.
const trackingSettingsOf = (config) => {
  let settings;
  if (config.clickTracking !== undefined) {
    settings ??= {};
    settings.click_tracking = { enable: config.clickTracking, enable_text: config.clickTracking };
  }
  if (config.openTracking !== undefined) {
    settings ??= {};
    settings.open_tracking = { enable: config.openTracking };
  }
  if (config.subscriptionTracking !== undefined) {
    settings ??= {};
    settings.subscription_tracking = { enable: config.subscriptionTracking };
  }
  if (config.googleAnalytics !== undefined) {
    settings ??= {};
    settings.ganalytics = { enable: config.googleAnalytics };
  }
  return settings;
};

/**
 * Formats an address for SendGrid API.
 *
 * @param address - The address to format
 * @returns Formatted address object
 */
const formatAddress = (address) => {
  const result = {
    email: toAsciiAddress(address.address),
  };

  if (address.name) {
    result.name = address.name;
  }

  return result;
};

/**
 * Converts a Upyo attachment to SendGrid format.
 *
 * @param attachment - The attachment to convert
 * @returns Promise that resolves to a SendGrid attachment object
 */
const convertAttachment = async (attachment, signal) => {
  // Get the content as Uint8Array then convert to base64
  const contentBytes = await readAttachmentContent(attachment.content, signal);

  const base64Content = toBase64(contentBytes);

  const sendGridAttachment = {
    content: base64Content,
    filename: attachment.filename,
  };

  if (attachment.contentType) {
    sendGridAttachment.type = attachment.contentType;
  }

  if (attachment.inline && attachment.contentId) {
    sendGridAttachment.disposition = 'inline';
    sendGridAttachment.content_id = attachment.contentId;
  } else {
    sendGridAttachment.disposition = 'attachment';
  }

  return sendGridAttachment;
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
  'x-priority',
  'x-msmail-priority',
  'importance',
]);

/**
 * Checks if a header is a standard email header that should not be added as custom header.
 *
 * @param headerName - The header name to check
 * @returns True if it's a standard header
 */
const isStandardHeader = (headerName) => {
  return STANDARD_HEADERS.has(headerName.toLowerCase());
};

module.exports = { convertMessage };
