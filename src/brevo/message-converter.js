// Ported from unemail v0.7.0 (src/drivers/brevo.ts): a message as the request
// of Brevo's transactional email API, `toPayload`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Also ported from sently v1.2.2 (src/transports/brevo.ts): the reply-to
// address.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: the idempotency key goes among the headers of the
// message, where Brevo's documentation puts it, as a UUID, generated when the
// message has none so that a retry cannot send twice; a second reply-to
// address and an inline attachment, which Brevo cannot take, are refused
// rather than dropped (sently dropped the custom headers too); `metadata`
// goes in `X-Mailin-custom`, which Brevo returns in its events.

const { generateId } = require('../core/id.js');
const { base64Attachments, headerFieldsOf, mailboxesOf, mailboxOf } = require('../internal/api.js');
const { toUuid } = require('../internal/uuid.js');
const { RefusalError } = require('../internal/refusal.js');

const addressOf = (address) => mailboxOf(address, 'email', 'name');

const addressesOf = (addresses) => mailboxesOf(addresses, 'email', 'name');

/**
 * Converts a message to a request of Brevo's `/v3/smtp/email`.
 *
 * @param message The message.
 * @param config The configuration.
 * @param signal Cancels the reads of the attachments.
 * @returns The request.
 * @throws {RangeError} If the message has two reply-to addresses or an
 * inline attachment.
 */
const convertMessage = async (message, config, signal) => {
  if (message.replyRecipients.length > 1) {
    throw new RefusalError('Brevo takes one reply-to address.');
  }
  const payload = {
    sender: addressOf(message.sender),
    to: addressesOf(message.recipients),
    subject: message.subject,
  };
  if (message.ccRecipients.length > 0) payload.cc = addressesOf(message.ccRecipients);
  if (message.bccRecipients.length > 0) payload.bcc = addressesOf(message.bccRecipients);
  if (message.replyRecipients.length === 1) payload.replyTo = addressOf(message.replyRecipients[0]);
  if ('html' in message.content) payload.htmlContent = message.content.html;
  if (message.content.text) payload.textContent = message.content.text;
  const headers = {};
  for (const field of headerFieldsOf(message)) headers[field.name] = field.value;
  if (message.metadata !== undefined) headers['X-Mailin-custom'] = JSON.stringify(message.metadata);
  if (config.sandbox) headers['X-Sib-Sandbox'] = 'drop';
  headers.idempotencyKey = toUuid(
    message.idempotencyKey ?? generateId('idempotency-key', config.generateId),
  );
  payload.headers = headers;
  if (message.tags.length > 0) payload.tags = [...message.tags];
  if (message.scheduledAt !== undefined) payload.scheduledAt = message.scheduledAt.toISOString();
  const attachments = await base64Attachments(message, signal);
  if (attachments.length > 0) {
    payload.attachment = [];
    for (const item of attachments) {
      if (item.attachment.inline) {
        throw new RefusalError('Brevo cannot send an inline attachment, for a cid: URL.');
      }
      payload.attachment.push({ name: item.attachment.filename, content: item.content });
    }
  }
  return payload;
};

module.exports = { convertMessage };
