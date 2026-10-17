// Ported from unemail v0.7.0 (src/drivers/cloudflare-email-rest.ts): a message
// as the request of `email/sending/send`, `toPayload`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: an address is `{ address, name }`, the reply-to
// address `reply_to` and the Content-ID `content_id`, as the REST API takes
// them, where unemail wrote the `{ email, name }`, `replyTo` and `contentId`
// of the Workers binding; metadata goes in `X-Metadata-<key>` headers; a
// second reply-to address and a scheduled message are refused; tags, which
// Cloudflare has no field for, are not sent, as over SMTP.

const { toAsciiAddress } = require('../core/address.js');
const { base64Attachments, headerFieldsOf } = require('../internal/api.js');
const { rawMessageText } = require('../internal/raw.js');
const { RawMessageValidationError } = require('../core/raw-message.js');
const { refuseScheduledAt } = require('../internal/schedule.js');
const { RefusalError } = require('../internal/refusal.js');

// "The combined number of addresses across to, cc, and bcc must not exceed 50."
const MAX_RECIPIENTS = 50;

const addressOf = (address) => {
  const result = { address: toAsciiAddress(address.address) };
  if (address.name) result.name = address.name;
  return result;
};

const addressesOf = (addresses) => {
  const list = [];
  for (let i = 0; i < addresses.length; i++) list.push(addressOf(addresses[i]));
  return list;
};

const checkLimits = (message) => {
  refuseScheduledAt(message, 'cloudflare');
  const total =
    message.recipients.length + message.ccRecipients.length + message.bccRecipients.length;
  if (total > MAX_RECIPIENTS) {
    throw new RefusalError(`Cloudflare takes at most ${MAX_RECIPIENTS} recipients a message.`);
  }
  if (message.replyRecipients.length > 1) {
    throw new RefusalError('Cloudflare takes one reply-to address.');
  }
};

const headersOf = (message) => {
  const headers = {};
  let hasHeaders = false;
  for (const field of headerFieldsOf(message)) {
    headers[field.name] = field.value;
    hasHeaders = true;
  }
  if (message.metadata !== undefined) {
    for (const key in message.metadata) {
      headers[`X-Metadata-${key}`] = message.metadata[key];
      hasHeaders = true;
    }
  }
  return hasHeaders ? headers : undefined;
};

/**
 * Converts a message to a request of `email/sending/send`.
 *
 * @param message The message.
 * @param signal Cancels the reads of the attachments.
 * @returns The request.
 * @throws {RangeError} If the message is over a limit of Cloudflare.
 * @throws {TypeError} If it is scheduled.
 */
const convertMessage = async (message, signal) => {
  checkLimits(message);
  const payload = { from: addressOf(message.sender), subject: message.subject };
  if (message.recipients.length > 0) payload.to = addressesOf(message.recipients);
  if (message.ccRecipients.length > 0) payload.cc = addressesOf(message.ccRecipients);
  if (message.bccRecipients.length > 0) payload.bcc = addressesOf(message.bccRecipients);
  if (message.replyRecipients.length === 1) {
    payload.reply_to = addressOf(message.replyRecipients[0]);
  }
  if (message.content.text) payload.text = message.content.text;
  if ('html' in message.content) payload.html = message.content.html;
  const headers = headersOf(message);
  if (headers !== undefined) payload.headers = headers;
  const attachments = await base64Attachments(message, signal);
  if (attachments.length > 0) {
    payload.attachments = [];
    for (const item of attachments) {
      const part = {
        content: item.content,
        filename: item.attachment.filename,
        type: item.attachment.contentType,
        disposition: item.attachment.inline ? 'inline' : 'attachment',
      };
      if (item.attachment.inline) part.content_id = item.attachment.contentId;
      payload.attachments.push(part);
    }
  }
  return payload;
};

/**
 * Converts a raw message, read with `readRawMessage`, to a request of
 * `email/sending/send_raw`, the envelope routing it.
 *
 * @param raw The envelope and bytes.
 * @returns The request.
 * @throws {RawMessageValidationError} If the envelope has no sender, or the
 * bytes are not UTF-8.
 */
const convertRawMessage = (raw) => {
  if (raw.envelope.from === null) {
    throw new RawMessageValidationError('Cloudflare needs a sender in the envelope.', 'envelope');
  }
  return {
    from: raw.envelope.from,
    recipients: raw.envelope.to,
    mime_message: rawMessageText(raw.bytes, 'Cloudflare'),
  };
};

module.exports = { convertMessage, convertRawMessage };
