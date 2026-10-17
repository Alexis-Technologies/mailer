// Ported from unemail v0.7.0 (src/drivers/smtp2go.ts): a message as the
// request of SMTP2GO's `/v3/email/send`, `toPayload` and `checkLimits`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: `schedule` is written as SMTP2GO documents it, with
// the window of three days read from an injected clock; and tags, which
// SMTP2GO has no field for, are not sent, as over SMTP.

const { formatMailbox } = require('../core/address.js');
const { base64Attachments, headerFieldsOf } = require('../internal/api.js');
const { formatAddresses } = require('../internal/provider.js');

// "An array of names and email addresses (up to 100)", in each field.
const MAX_RECIPIENTS = 100;
// `schedule` "must be in the future and within the next 3 days".
const SCHEDULE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

const checkLimits = (message, config) => {
  for (const [field, name] of [
    ['recipients', 'to'],
    ['ccRecipients', 'cc'],
    ['bccRecipients', 'bcc'],
  ]) {
    if (message[field].length > MAX_RECIPIENTS) {
      throw new RangeError(`SMTP2GO takes at most ${MAX_RECIPIENTS} ${name} recipients.`);
    }
  }
  if (
    message.scheduledAt !== undefined &&
    message.scheduledAt.getTime() - config.now() > SCHEDULE_WINDOW_MS
  ) {
    throw new RangeError('SMTP2GO schedules a message at most 3 days ahead.');
  }
};

// "2025-09-10 13:15:00 +1200", the form of SMTP2GO's example.
const scheduleOf = (date) => {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} +0000`;
};

const headersOf = (message) => {
  const headers = [];
  // The fields SMTP2GO forbids, Content-Type, Content-Transfer-Encoding and
  // MIME-Version, are those of the MIME structure, never among these.
  for (const field of headerFieldsOf(message)) {
    headers.push({ header: field.name, value: field.value });
  }
  // SMTP2GO has no reply-to or metadata field: a header field is the
  // documented way for the first, and reaches the events for the second.
  if (message.replyRecipients.length > 0) {
    const value = formatAddresses(message.replyRecipients, formatMailbox).join(', ');
    headers.push({ header: 'Reply-To', value });
  }
  if (message.metadata !== undefined) {
    for (const key in message.metadata) {
      headers.push({ header: `X-Metadata-${key}`, value: message.metadata[key] });
    }
  }
  return headers;
};

/**
 * Converts a message to a request of `/v3/email/send`.
 *
 * @param message The message.
 * @param config The configuration.
 * @param signal Cancels the reads of the attachments.
 * @returns The request.
 * @throws {RangeError} If the message is over a limit of SMTP2GO.
 */
const convertMessage = async (message, config, signal) => {
  checkLimits(message, config);
  const payload = {
    sender: formatMailbox(message.sender),
    to: formatAddresses(message.recipients, formatMailbox),
    subject: message.subject,
  };
  if (message.ccRecipients.length > 0) {
    payload.cc = formatAddresses(message.ccRecipients, formatMailbox);
  }
  if (message.bccRecipients.length > 0) {
    payload.bcc = formatAddresses(message.bccRecipients, formatMailbox);
  }
  if (message.content.text) payload.text_body = message.content.text;
  if ('html' in message.content) payload.html_body = message.content.html;
  const headers = headersOf(message);
  if (headers.length > 0) payload.custom_headers = headers;
  for (const item of await base64Attachments(message, signal)) {
    const file = { fileblob: item.content, mimetype: item.attachment.contentType };
    if (item.attachment.inline) {
      // An inline image is named in the HTML as `cid:<filename>`.
      file.filename = item.attachment.contentId;
      payload.inlines ??= [];
      payload.inlines.push(file);
    } else {
      file.filename = item.attachment.filename;
      payload.attachments ??= [];
      payload.attachments.push(file);
    }
  }
  if (message.scheduledAt !== undefined) payload.schedule = scheduleOf(message.scheduledAt);
  if (config.fastAccept === true) payload.fastaccept = true;
  return payload;
};

module.exports = { convertMessage };
