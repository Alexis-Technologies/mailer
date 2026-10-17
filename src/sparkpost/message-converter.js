// Ported from sently v1.2.2 (src/transports/sparkpost.ts): a message as a
// transmission of the SparkPost API.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: cc and bcc recipients get `header_to`, the To field
// every recipient sees, and the cc ones a CC field, where sently put them all
// in `recipients` alone, so the Cc field was lost and each recipient saw only
// itself in To; inline images go in `inline_images`; custom fields, tags,
// metadata, tracking and `scheduledAt` (`start_time`) are sent; and a raw
// message goes as `email_rfc822`.

const { formatMailbox, toAsciiAddress } = require('../core/address.js');
const { base64Attachments, headerFieldsOf } = require('../internal/api.js');
const { formatAddresses } = require('../internal/provider.js');
const { rawMessageText } = require('../internal/raw.js');

// "Maximum number of tags - 10 per recipient".
const MAX_TAGS = 10;

// `start_time` is "YYYY-MM-DDTHH:MM:SS+-HH:MM", without milliseconds.
const startTimeOf = (date) => `${date.toISOString().slice(0, 19)}+00:00`;

const addressOf = (address, headerTo) => {
  const result = { email: toAsciiAddress(address.address) };
  if (address.name) result.name = address.name;
  if (headerTo !== undefined) result.header_to = headerTo;
  return result;
};

const optionsOf = (message, config) => {
  const options = {};
  const opens = message?.tracking?.opens ?? config.openTracking;
  const clicks = message?.tracking?.clicks ?? config.clickTracking;
  if (opens !== undefined) options.open_tracking = opens;
  if (clicks !== undefined) options.click_tracking = clicks;
  if (config.transactional !== undefined) options.transactional = config.transactional;
  if (message?.scheduledAt !== undefined) options.start_time = startTimeOf(message.scheduledAt);
  return options;
};

const recipientsOf = (message) => {
  // SparkPost sends a copy to each recipient, whose To field names that
  // recipient alone unless `header_to` gives the one every copy shares.
  const total =
    message.recipients.length + message.ccRecipients.length + message.bccRecipients.length;
  const headerTo =
    total > 1 ? formatAddresses(message.recipients, formatMailbox).join(', ') : undefined;
  const tags = message.tags.length > 0 ? [...message.tags] : undefined;
  const recipients = [];
  for (const list of [message.recipients, message.ccRecipients, message.bccRecipients]) {
    for (let i = 0; i < list.length; i++) {
      const recipient = { address: addressOf(list[i], headerTo) };
      if (tags !== undefined) recipient.tags = tags;
      recipients.push(recipient);
    }
  }
  return recipients;
};

const contentOf = async (message, signal) => {
  const content = { from: addressOf(message.sender), subject: message.subject };
  if (message.content.text) content.text = message.content.text;
  if ('html' in message.content) content.html = message.content.html;
  if (message.replyRecipients.length > 0) {
    content.reply_to = formatAddresses(message.replyRecipients, formatMailbox).join(', ');
  }
  const headers = {};
  let hasHeaders = false;
  if (message.ccRecipients.length > 0) {
    headers.CC = formatAddresses(message.ccRecipients, formatMailbox).join(', ');
    hasHeaders = true;
  }
  for (const field of headerFieldsOf(message)) {
    headers[field.name] = field.value;
    hasHeaders = true;
  }
  if (hasHeaders) content.headers = headers;
  for (const item of await base64Attachments(message, signal)) {
    const part = { type: item.attachment.contentType, data: item.content };
    if (item.attachment.inline) {
      part.name = item.attachment.contentId;
      content.inline_images ??= [];
      content.inline_images.push(part);
    } else {
      part.name = item.attachment.filename;
      content.attachments ??= [];
      content.attachments.push(part);
    }
  }
  return content;
};

/**
 * Converts a message to a transmission.
 *
 * @param message The message.
 * @param config The configuration.
 * @param signal Cancels the reads of the attachments.
 * @returns The transmission.
 * @throws {RangeError} If the message has more than ten tags.
 */
const convertMessage = async (message, config, signal) => {
  if (message.tags.length > MAX_TAGS) {
    throw new RangeError(`SparkPost takes at most ${MAX_TAGS} tags.`);
  }
  const transmission = {
    recipients: recipientsOf(message),
    content: await contentOf(message, signal),
  };
  const options = optionsOf(message, config);
  if (Object.keys(options).length > 0) transmission.options = options;
  if (config.campaignId !== undefined) transmission.campaign_id = config.campaignId;
  if (message.metadata !== undefined) transmission.metadata = { ...message.metadata };
  return transmission;
};

/**
 * Converts a raw message, read with `readRawMessage`, to a transmission of
 * its RFC 822 text to the recipients of its envelope.
 *
 * @param raw The envelope and bytes.
 * @param config The configuration.
 * @returns The transmission.
 */
const convertRawMessage = (raw, config) => {
  const recipients = [];
  for (const email of raw.envelope.to) recipients.push({ address: { email } });
  const transmission = {
    recipients,
    // The API takes the message as a JSON string.
    content: { email_rfc822: rawMessageText(raw.bytes, 'SparkPost') },
  };
  const options = optionsOf(undefined, config);
  if (Object.keys(options).length > 0) transmission.options = options;
  if (config.campaignId !== undefined) transmission.campaign_id = config.campaignId;
  return transmission;
};

module.exports = { convertMessage, convertRawMessage };
