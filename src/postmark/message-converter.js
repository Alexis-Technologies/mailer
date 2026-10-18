// Ported from unemail v0.7.0 (src/drivers/postmark.ts): a message as the
// request of Postmark's email API, `toPayload`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Also ported from sently v1.2.2 (src/transports/postmark.ts): the inline
// attachments and the reply-to addresses.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: display names are quoted when they need it; an inline
// part goes with `cid:` before its Content-ID, which sently left out; a second
// tag is refused rather than sent as metadata, as Postmark has one `Tag`; and
// a scheduled message is refused.

const { formatMailbox } = require('../core/address.js');
const { base64Attachments, headerFieldsOf } = require('../internal/api.js');
const { formatAddresses } = require('../internal/provider.js');
const { refuseScheduledAt } = require('../internal/schedule.js');
const { RefusalError } = require('../internal/refusal.js');

const addressList = (addresses) => formatAddresses(addresses, formatMailbox).join(', ');

const trackingOf = (message, config) => {
  const opens = message.tracking?.opens ?? config.openTracking;
  const clicks = message.tracking?.clicks ?? config.clickTracking;
  return { opens, clicks };
};

/**
 * Converts a message to a request of Postmark's `/email`.
 *
 * @param message The message.
 * @param config The configuration.
 * @param signal Cancels the reads of the attachments.
 * @returns The request.
 * @throws {TypeError} If the message is scheduled.
 * @throws {RangeError} If it has more than one tag.
 */
const convertMessage = async (message, config, signal) => {
  refuseScheduledAt(message, 'postmark');
  if (message.tags.length > 1) throw new RefusalError('Postmark takes one tag per message.');
  const payload = {
    From: formatMailbox(message.sender),
    To: addressList(message.recipients),
    Subject: message.subject,
  };
  if (message.ccRecipients.length > 0) payload.Cc = addressList(message.ccRecipients);
  if (message.bccRecipients.length > 0) payload.Bcc = addressList(message.bccRecipients);
  if (message.replyRecipients.length > 0) payload.ReplyTo = addressList(message.replyRecipients);
  if ('html' in message.content) {
    payload.HtmlBody = message.content.html;
    if (message.content.text) payload.TextBody = message.content.text;
  } else {
    payload.TextBody = message.content.text;
  }
  const fields = headerFieldsOf(message);
  if (fields.length > 0) {
    payload.Headers = [];
    for (const field of fields) payload.Headers.push({ Name: field.name, Value: field.value });
  }
  if (message.tags.length === 1) payload.Tag = message.tags[0];
  if (message.metadata !== undefined) payload.Metadata = { ...message.metadata };
  const tracking = trackingOf(message, config);
  if (tracking.opens !== undefined) payload.TrackOpens = tracking.opens;
  if (tracking.clicks !== undefined) payload.TrackLinks = tracking.clicks ? 'HtmlAndText' : 'None';
  if (config.messageStream !== undefined) payload.MessageStream = config.messageStream;
  const attachments = await base64Attachments(message, signal);
  if (attachments.length > 0) {
    payload.Attachments = [];
    for (const item of attachments) {
      const attachment = item.attachment;
      const part = {
        Name: attachment.filename,
        Content: item.content,
        ContentType: attachment.contentType,
      };
      if (attachment.inline) part.ContentID = `cid:${attachment.contentId}`;
      payload.Attachments.push(part);
    }
  }
  return payload;
};

module.exports = { convertMessage };
