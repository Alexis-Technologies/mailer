// Ported from unemail v0.7.0 (src/drivers/scaleway.ts): a message as the
// request of Scaleway's `/emails`, `toPayload` and `toHeaders`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: an inline attachment is refused, where unemail sent
// it as an ordinary file without its Content-ID, so the `cid:` of the HTML
// matched nothing; tags, which Scaleway has no field for, are not sent, as
// over SMTP; and a scheduled message is refused.

const { formatMailbox } = require('../core/address.js');
const {
  base64Attachments,
  headerFieldsOf,
  mailboxesOf,
  mailboxOf,
  visitMetadataHeaders,
} = require('../internal/api.js');
const { formatAddresses } = require('../internal/provider.js');
const { refuseScheduledAt } = require('../internal/schedule.js');
const { RefusalError } = require('../internal/refusal.js');

// "Maximum email size (API): 2 MB, including the email and all attachments".
const MAX_EMAIL_BYTES = 2 * 1024 * 1024;

const addressOf = (address) => mailboxOf(address, 'email', 'name');

const addressesOf = (addresses) => mailboxesOf(addresses, 'email', 'name');

// Scaleway has no reply-to or metadata field: both are header fields, as its
// documentation shows for Reply-To.
const headersOf = (message) => {
  const headers = [];
  for (const field of headerFieldsOf(message)) {
    headers.push({ key: field.name, value: field.value });
  }
  if (message.replyRecipients.length > 0) {
    const value = formatAddresses(message.replyRecipients, formatMailbox).join(', ');
    headers.push({ key: 'Reply-To', value });
  }
  visitMetadataHeaders(message, (key, value) => headers.push({ key, value }));
  return headers;
};

/**
 * Converts a message to a request of `/emails`.
 *
 * @param message The message.
 * @param config The configuration.
 * @param signal Cancels the reads of the attachments.
 * @returns The request.
 * @throws {RangeError} If the message has an inline attachment, or is over
 * 2 MB.
 * @throws {TypeError} If it is scheduled.
 */
const convertMessage = async (message, config, signal) => {
  refuseScheduledAt(message, 'scaleway');
  for (const attachment of message.attachments) {
    if (attachment.inline) {
      throw new RefusalError(
        'Scaleway cannot send an inline attachment, which it has no Content-ID for.',
      );
    }
  }
  const payload = {
    from: addressOf(message.sender),
    to: addressesOf(message.recipients),
    subject: message.subject,
    project_id: config.projectId,
  };
  if (message.ccRecipients.length > 0) payload.cc = addressesOf(message.ccRecipients);
  if (message.bccRecipients.length > 0) payload.bcc = addressesOf(message.bccRecipients);
  if (message.content.text) payload.text = message.content.text;
  if ('html' in message.content) payload.html = message.content.html;
  const headers = headersOf(message);
  if (headers.length > 0) payload.additional_headers = headers;
  const attachments = await base64Attachments(message, signal);
  if (attachments.length > 0) {
    payload.attachments = [];
    for (const item of attachments) {
      payload.attachments.push({
        name: item.attachment.filename,
        type: item.attachment.contentType,
        content: item.content,
      });
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > MAX_EMAIL_BYTES) {
    throw new RefusalError(
      `The request is ${bytes} bytes; Scaleway takes at most ${MAX_EMAIL_BYTES}, attachments included.`,
    );
  }
  return payload;
};

module.exports = { convertMessage };
