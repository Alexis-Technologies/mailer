// Ported from unemail v0.7.0 (src/drivers/zeptomail.ts): a message as the
// request of ZeptoMail's `/v1.1/email`, `sharedPayload` and `validate`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: a tag is the `client_reference`, a second one
// refused, as ZeptoMail has no tags; and a scheduled message is refused.

const { toAsciiAddress } = require('../core/address.js');
const { base64Attachments, headerFieldsOf } = require('../internal/api.js');
const { refuseScheduledAt } = require('../internal/schedule.js');

// At most 500 addresses in each of to, cc and bcc (TM_8001, SM_127).
const MAX_RECIPIENTS = 500;
const MAX_ATTACHMENTS = 60;
const MAX_SUBJECT = 500;

const addressOf = (address) => {
  const result = { address: toAsciiAddress(address.address) };
  if (address.name) result.name = address.name;
  return result;
};

const recipientsOf = (addresses) => {
  const list = [];
  for (let i = 0; i < addresses.length; i++) list.push({ email_address: addressOf(addresses[i]) });
  return list;
};

const checkLimits = (message) => {
  refuseScheduledAt(message, 'zeptomail');
  for (const [field, name] of [
    ['recipients', 'to'],
    ['ccRecipients', 'cc'],
    ['bccRecipients', 'bcc'],
  ]) {
    if (message[field].length > MAX_RECIPIENTS) {
      throw new RangeError(`ZeptoMail takes at most ${MAX_RECIPIENTS} ${name} recipients.`);
    }
  }
  if (message.attachments.length > MAX_ATTACHMENTS) {
    throw new RangeError(`ZeptoMail takes at most ${MAX_ATTACHMENTS} attachments.`);
  }
  if (message.subject.length > MAX_SUBJECT) {
    throw new RangeError(`ZeptoMail takes a subject of at most ${MAX_SUBJECT} characters.`);
  }
  if (message.tags.length > 1) {
    throw new RangeError('ZeptoMail takes one tag per message, as its client_reference.');
  }
};

const headersOf = (message) => {
  const headers = {};
  let hasHeaders = false;
  for (const field of headerFieldsOf(message)) {
    headers[field.name] = field.value;
    hasHeaders = true;
  }
  // ZeptoMail has no metadata of its own: its events carry the headers.
  if (message.metadata !== undefined) {
    for (const key in message.metadata) {
      headers[`X-Metadata-${key}`] = message.metadata[key];
      hasHeaders = true;
    }
  }
  return hasHeaders ? headers : undefined;
};

/**
 * Converts a message to a request of `/v1.1/email`.
 *
 * @param message The message.
 * @param config The configuration.
 * @param signal Cancels the reads of the attachments.
 * @returns The request.
 * @throws {RangeError} If the message is over a limit of ZeptoMail.
 * @throws {TypeError} If it is scheduled.
 */
const convertMessage = async (message, config, signal) => {
  checkLimits(message);
  const payload = {
    from: addressOf(message.sender),
    to: recipientsOf(message.recipients),
    subject: message.subject,
  };
  if (message.ccRecipients.length > 0) payload.cc = recipientsOf(message.ccRecipients);
  if (message.bccRecipients.length > 0) payload.bcc = recipientsOf(message.bccRecipients);
  if (message.replyRecipients.length > 0) {
    payload.reply_to = [];
    for (const address of message.replyRecipients) payload.reply_to.push(addressOf(address));
  }
  if (message.content.text) payload.textbody = message.content.text;
  if ('html' in message.content) payload.htmlbody = message.content.html;
  const headers = headersOf(message);
  if (headers !== undefined) payload.mime_headers = headers;
  const reference = message.tags[0] ?? config.clientReference;
  if (reference !== undefined) payload.client_reference = reference;
  if (config.bounceAddress !== undefined) payload.bounce_address = config.bounceAddress;
  const opens = message.tracking?.opens ?? config.openTracking;
  const clicks = message.tracking?.clicks ?? config.clickTracking;
  if (opens !== undefined) payload.track_opens = opens;
  if (clicks !== undefined) payload.track_clicks = clicks;
  for (const item of await base64Attachments(message, signal)) {
    const part = { content: item.content, mime_type: item.attachment.contentType };
    if (item.attachment.inline) {
      part.cid = item.attachment.contentId;
      payload.inline_images ??= [];
      payload.inline_images.push(part);
    } else {
      part.name = item.attachment.filename;
      payload.attachments ??= [];
      payload.attachments.push(part);
    }
  }
  return payload;
};

module.exports = { convertMessage };
