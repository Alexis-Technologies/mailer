// Ported from upyo v0.7.0 (packages/lettermint/src/message-converter.ts)
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
 * Converts an Upyo message to Lettermint API JSON format.
 *
 * @param message The Upyo message to convert.
 * @param config The resolved Lettermint configuration.
 * @returns JSON object ready for Lettermint API submission.
 * @throws {TypeError} If the message carries an invalid message identifier.
 * @throws {RangeError} If the message has more than one tag.
 */
const convertMessage = async (message, config, signal) => {
  if (message.tags.length > 1) {
    throw new RangeError('Lettermint supports at most one tag per message.');
  }

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
  };

  if (message.ccRecipients.length > 0) {
    emailData.cc = message.ccRecipients.map(formatAddress);
  }

  if (message.bccRecipients.length > 0) {
    emailData.bcc = message.bccRecipients.map(formatAddress);
  }

  if (message.replyRecipients.length > 0) {
    emailData.reply_to = message.replyRecipients.map(formatAddress);
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

  if (config.metadata != null && Object.keys(config.metadata).length > 0) {
    emailData.metadata = { ...config.metadata };
  }

  const settings = convertSettings(config);
  if (settings != null) {
    emailData.settings = settings;
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
  const ownedHeaders = lowerCaseNames(threading.keys());

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

  return emailData;
};

const convertSettings = (config) => {
  if (config.settings == null) return undefined;

  const settings = {};

  if (config.settings.trackOpens !== undefined) {
    settings.track_opens = config.settings.trackOpens;
  }

  if (config.settings.trackClicks !== undefined) {
    settings.track_clicks = config.settings.trackClicks;
  }

  return Object.keys(settings).length > 0 ? settings : undefined;
};

const formatAddress = (address) => {
  if (address.name) {
    const escapedName = address.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escapedName}" <${address.address}>`;
  }
  return address.address;
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
