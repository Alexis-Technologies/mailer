// Ported from unemail v0.7.0 (src/drivers/mailersend.ts): a message as the
// request of MailerSend's email API, `toPayload` and `validate`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Also ported from sently v1.2.2 (src/transports/mailersend.ts): the reply-to
// address and the inline attachments.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: the threading fields and List-Unsubscribe go in the
// fields MailerSend has for them, the name of a metadata header is a checked
// key, a second reply-to address is refused, and sently's dropped custom
// headers are sent.

const { toAsciiAddress } = require('../core/address.js');
const { parseMessageId } = require('../core/message-id.js');
const { base64Attachments, headerFieldsOf } = require('../internal/api.js');
const { RefusalError } = require('../internal/refusal.js');

const LIMITS = [
  ['recipients', 'to', 50],
  ['ccRecipients', 'cc', 10],
  ['bccRecipients', 'bcc', 10],
];
const MAX_TAGS = 5;
// `send_at` may be at most 72 hours ahead.
const SCHEDULE_WINDOW_MS = 72 * 60 * 60 * 1000;

// The fields MailerSend reads from a property of its own.
const OWN_FIELDS = new Set([
  'in-reply-to',
  'references',
  'list-unsubscribe',
  'list-unsubscribe-post',
]);

const addressOf = (address) => {
  const email = toAsciiAddress(address.address);
  return address.name ? { email, name: address.name } : { email };
};

const addressesOf = (addresses) => {
  const list = [];
  for (let i = 0; i < addresses.length; i++) list.push(addressOf(addresses[i]));
  return list;
};

const checkLimits = (message, config) => {
  for (const [field, name, limit] of LIMITS) {
    if (message[field].length > limit) {
      throw new RefusalError(`MailerSend takes at most ${limit} ${name} recipients.`);
    }
  }
  if (message.tags.length > MAX_TAGS) {
    throw new RefusalError(`MailerSend takes at most ${MAX_TAGS} tags.`);
  }
  if (message.replyRecipients.length > 1) {
    throw new RefusalError('MailerSend takes one reply-to address.');
  }
  if (
    message.scheduledAt !== undefined &&
    message.scheduledAt.getTime() - config.now() > SCHEDULE_WINDOW_MS
  ) {
    throw new RefusalError('MailerSend schedules a message at most 72 hours ahead.');
  }
};

// The identifiers of In-Reply-To or References, without their brackets.
const messageIdsOf = (value) => {
  const ids = [];
  for (const part of value.split(/\s+/)) {
    const id = parseMessageId(part);
    if (id !== undefined) ids.push(id);
  }
  return ids;
};

const placeHeaders = (payload, message) => {
  const headers = [];
  for (const field of headerFieldsOf(message)) {
    const name = field.name.toLowerCase();
    if (!OWN_FIELDS.has(name)) {
      headers.push({ name: field.name, value: field.value });
    } else if (name === 'in-reply-to') {
      payload.in_reply_to = messageIdsOf(field.value)[0];
    } else if (name === 'references') {
      payload.references = messageIdsOf(field.value);
    } else if (name === 'list-unsubscribe') {
      // MailerSend writes List-Unsubscribe-Post itself, as RFC 8058 asks.
      payload.list_unsubscribe = field.value;
    }
  }
  // MailerSend has no metadata of its own: a header reaches its events.
  if (message.metadata !== undefined) {
    for (const key in message.metadata) {
      headers.push({ name: `X-Metadata-${key}`, value: message.metadata[key] });
    }
  }
  if (headers.length > 0) payload.headers = headers;
};

/**
 * Converts a message to a request of MailerSend's `/v1/email`.
 *
 * @param message The message.
 * @param config The configuration.
 * @param signal Cancels the reads of the attachments.
 * @returns The request.
 * @throws {RangeError} If the message is over a limit of MailerSend.
 */
const convertMessage = async (message, config, signal) => {
  checkLimits(message, config);
  const payload = {
    from: addressOf(message.sender),
    to: addressesOf(message.recipients),
    subject: message.subject,
  };
  if (message.ccRecipients.length > 0) payload.cc = addressesOf(message.ccRecipients);
  if (message.bccRecipients.length > 0) payload.bcc = addressesOf(message.bccRecipients);
  if (message.replyRecipients.length === 1) {
    payload.reply_to = addressOf(message.replyRecipients[0]);
  }
  if (message.content.text) payload.text = message.content.text;
  if ('html' in message.content) payload.html = message.content.html;
  placeHeaders(payload, message);
  if (message.tags.length > 0) payload.tags = [...message.tags];
  const settings = {};
  const opens = message.tracking?.opens ?? config.openTracking;
  const clicks = message.tracking?.clicks ?? config.clickTracking;
  if (opens !== undefined) settings.track_opens = opens;
  if (clicks !== undefined) settings.track_clicks = clicks;
  if (opens !== undefined || clicks !== undefined) payload.settings = settings;
  if (config.precedenceBulk !== undefined) payload.precedence_bulk = config.precedenceBulk;
  if (message.scheduledAt !== undefined) {
    payload.send_at = Math.floor(message.scheduledAt.getTime() / 1000);
  }
  const attachments = await base64Attachments(message, signal);
  if (attachments.length > 0) {
    payload.attachments = [];
    for (const item of attachments) {
      const part = { filename: item.attachment.filename, content: item.content };
      if (item.attachment.inline) {
        part.disposition = 'inline';
        part.id = item.attachment.contentId;
      } else {
        part.disposition = 'attachment';
      }
      payload.attachments.push(part);
    }
  }
  return payload;
};

module.exports = { convertMessage };
