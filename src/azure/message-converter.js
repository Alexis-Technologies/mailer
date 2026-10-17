// Ported from unemail v0.7.0 (src/drivers/azure-communication.ts): a message
// as the request of `emails:send`, `toPayload` and `trackingDisabled`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: a message that asks for opens without clicks, or the
// reverse, is refused, as Azure has one switch for both and unemail turned
// both on; tags, which Azure has no field for, are not sent, as over SMTP;
// and a scheduled message is refused.

const { toAsciiAddress } = require('../core/address.js');
const { base64Attachments, headerFieldsOf } = require('../internal/api.js');
const { refuseScheduledAt } = require('../internal/schedule.js');

/** Azure takes a request of at most 10 MB, its attachments included. */
const MAX_REQUEST_BYTES = 10 * 1024 * 1024;

const addressOf = (address) => {
  const result = { address: toAsciiAddress(address.address) };
  if (address.name) result.displayName = address.name;
  return result;
};

const addressesOf = (addresses) => {
  const list = [];
  for (let i = 0; i < addresses.length; i++) list.push(addressOf(addresses[i]));
  return list;
};

// `userEngagementTrackingDisabled` turns opens and clicks off together, and
// can only turn off what the resource has on.
const trackingDisabledOf = (message, config) => {
  const tracking = message.tracking;
  if (tracking === undefined) return config.userEngagementTrackingDisabled;
  const { opens, clicks } = tracking;
  if (opens !== undefined && clicks !== undefined && opens !== clicks) {
    throw new RangeError('Azure turns open and click tracking on or off together.');
  }
  const wanted = opens ?? clicks;
  return wanted === undefined ? config.userEngagementTrackingDisabled : !wanted;
};

const headersOf = (message) => {
  const headers = {};
  let hasHeaders = false;
  for (const field of headerFieldsOf(message)) {
    headers[field.name] = field.value;
    hasHeaders = true;
  }
  // Azure has no metadata of its own: a header field carries it.
  if (message.metadata !== undefined) {
    for (const key in message.metadata) {
      headers[`X-Metadata-${key}`] = message.metadata[key];
      hasHeaders = true;
    }
  }
  return hasHeaders ? headers : undefined;
};

/**
 * Converts a message to a request of `emails:send`.  The sender goes as its
 * address alone: its display name is that of the sender in the resource.
 *
 * @param message The message.
 * @param config The configuration.
 * @param signal Cancels the reads of the attachments.
 * @returns The request.
 * @throws {RangeError} If the message asks for one kind of tracking without
 * the other, or the request would be over 10 MB.
 * @throws {TypeError} If it is scheduled.
 */
const convertMessage = async (message, config, signal) => {
  refuseScheduledAt(message, 'azure');
  const recipients = { to: addressesOf(message.recipients) };
  if (message.ccRecipients.length > 0) recipients.cc = addressesOf(message.ccRecipients);
  if (message.bccRecipients.length > 0) recipients.bcc = addressesOf(message.bccRecipients);
  const content = { subject: message.subject };
  if (message.content.text) content.plainText = message.content.text;
  if ('html' in message.content) content.html = message.content.html;
  const payload = { senderAddress: toAsciiAddress(message.sender.address), recipients, content };
  if (message.replyRecipients.length > 0) payload.replyTo = addressesOf(message.replyRecipients);
  const headers = headersOf(message);
  if (headers !== undefined) payload.headers = headers;
  const disabled = trackingDisabledOf(message, config);
  if (disabled !== undefined) payload.userEngagementTrackingDisabled = disabled;
  const attachments = await base64Attachments(message, signal);
  if (attachments.length > 0) {
    payload.attachments = [];
    for (const item of attachments) {
      const part = {
        name: item.attachment.filename,
        contentType: item.attachment.contentType,
        contentInBase64: item.content,
      };
      if (item.attachment.inline) part.contentId = item.attachment.contentId;
      payload.attachments.push(part);
    }
  }
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > MAX_REQUEST_BYTES) {
    throw new RangeError(
      `The request is ${bytes} bytes; Azure takes at most ${MAX_REQUEST_BYTES}, attachments included.`,
    );
  }
  return payload;
};

module.exports = { convertMessage };
