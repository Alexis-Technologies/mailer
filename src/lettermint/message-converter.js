// Ported from upyo v0.7.0 (packages/lettermint/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { generateId } = require('../core/id.js');
const { toAsciiAddress } = require('../core/address.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { toBase64 } = require('../internal/base64.js');
const { refuseScheduledAt } = require('../internal/schedule.js');
const { RefusalError } = require('../internal/refusal.js');
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
 * Converts an Upyo message to Lettermint API JSON format.
 *
 * @param message The Upyo message to convert.
 * @param config The resolved Lettermint configuration.
 * @returns JSON object ready for Lettermint API submission.
 * @throws {TypeError} If the message carries an invalid message identifier.
 * @throws {RefusalError} If the message has more than one tag, or `scheduledAt`.
 */
const convertMessage = async (message, config, signal) => {
  refuseScheduledAt(message, 'lettermint');
  if (message.tags.length > 1) {
    throw new RefusalError('Lettermint supports at most one tag per message.');
  }

  const attachments = withCalendarAttachment(message);
  const emailData = {
    from: formatAddress(message.sender),
    to: formatAddresses(message.recipients, formatAddress),
    subject: message.subject,
  };
  if (message.ccRecipients.length > 0) {
    emailData.cc = formatAddresses(message.ccRecipients, formatAddress);
  }
  if (message.bccRecipients.length > 0) {
    emailData.bcc = formatAddresses(message.bccRecipients, formatAddress);
  }
  if (message.replyRecipients.length > 0) {
    emailData.reply_to = formatAddresses(message.replyRecipients, formatAddress);
  }

  if ('html' in message.content) {
    emailData.html = message.content.html;
    if (message.content.text) {
      emailData.text = message.content.text;
    }
  } else {
    emailData.text = message.content.text;
  }

  if (config.route) {
    emailData.route = config.route;
  }

  if (message.tags.length === 1) {
    emailData.tag = message.tags[0];
  } else if (config.tag !== undefined) {
    emailData.tag = config.tag;
  }

  // The metadata of the configuration, that of the message over it.
  const metadata = { ...config.metadata, ...message.metadata };
  if (Object.keys(metadata).length > 0) {
    emailData.metadata = metadata;
  }

  const settings = convertSettings(config, message.tracking);
  if (settings != null) {
    emailData.settings = settings;
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

  return emailData;
};

// The tracking of the message over the settings of the configuration.
const convertSettings = (config, tracking) => {
  const settings = {};

  const opens = tracking?.opens ?? config.settings?.trackOpens;
  if (opens !== undefined) {
    settings.track_opens = opens;
  }

  const clicks = tracking?.clicks ?? config.settings?.trackClicks;
  if (clicks !== undefined) {
    settings.track_clicks = clicks;
  }

  return Object.keys(settings).length > 0 ? settings : undefined;
};

const formatAddress = (address) => {
  if (address.name) {
    const escapedName = address.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escapedName}" <${toAsciiAddress(address.address)}>`;
  }
  return toAsciiAddress(address.address);
};

const convertAttachment = async (attachment, signal) => {
  const content = await readAttachmentContent(attachment.content, signal);
  const converted = {
    filename: attachment.filename,
    content: toBase64(content),
    content_type: attachment.contentType,
  };

  if (attachment.inline && attachment.contentId) {
    converted.content_id = attachment.contentId;
  }

  return converted;
};

const isStandardHeader = (headerName) => {
  return STANDARD_HEADERS.has(headerName.toLowerCase());
};

/**
 * Generates a random idempotency key for request deduplication.
 *
 * @param generator Optional generator of the application.
 * @returns A unique string suitable for use as an idempotency key.
 */
const generateIdempotencyKey = (generator) => generateId('idempotency-key', generator);

module.exports = { convertMessage, generateIdempotencyKey };
