// Ported from unemail v0.7.0 (src/drivers/mailjet.ts): a message as an entry
// of the `Messages` of Mailjet's Send API v3.1, `toMessage` and `checkLimits`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: the fields Mailjet sets itself are refused by name,
// those of `list` and the threading fields among them; a second tag is
// refused, as `CustomCampaign` is one name; `metadata` goes in `EventPayload`;
// and a scheduled message is refused.

const { toAsciiAddress } = require('../core/address.js');
const { base64Attachments, headerFieldsOf } = require('../internal/api.js');
const { refuseScheduledAt } = require('../internal/schedule.js');

// "MAX RECIPIENTS: 50", across To, Cc and Bcc of the whole request.
const MAX_RECIPIENTS = 50;
// "Maximum length is 255 chars".
const MAX_SUBJECT = 255;

// The fields Mailjet sets itself, or from a property of its own; it fails a
// message that gives one with send-0011.
const FORBIDDEN_HEADERS = new Set([
  'from',
  'sender',
  'subject',
  'to',
  'cc',
  'bcc',
  'reply-to',
  'return-path',
  'delivered-to',
  'dkim-signature',
  'domainkey-status',
  'received-spf',
  'authentication-results',
  'received',
  'date',
  'message-id',
  'user-agent',
  'x-mailer',
  'list-id',
  'x-csa-complaints',
  'x-feedback-id',
  'x-mailjet-prio',
  'x-mailjet-debug',
  'x-mailjet-campaign',
  'x-mailjet-segmentation',
  'x-mailjet-trackopen',
  'x-mailjet-trackclick',
  'x-mj-customid',
  'x-mj-eventpayload',
  'x-mj-vars',
  'x-mj-templateid',
  'x-mj-templatelanguage',
  'x-mj-templateerrordeliver',
  'x-mj-templateerrorreporting',
  'x-mj-workflowid',
  'x-mj-mid',
  'x-mj-errormessage',
  'x-mj-statisticscontactslistid',
]);

const addressOf = (address) => {
  const email = toAsciiAddress(address.address);
  return address.name ? { Email: email, Name: address.name } : { Email: email };
};

const addressesOf = (addresses) => {
  const list = [];
  for (let i = 0; i < addresses.length; i++) list.push(addressOf(addresses[i]));
  return list;
};

/**
 * The recipients of a message, an address counted once, as Mailjet counts
 * them against its limit.
 *
 * @internal
 */
const recipientCount = (message) => {
  const seen = new Set();
  for (const list of [message.recipients, message.ccRecipients, message.bccRecipients]) {
    for (let i = 0; i < list.length; i++) seen.add(list[i].address.toLowerCase());
  }
  return seen.size;
};

const checkLimits = (message) => {
  refuseScheduledAt(message, 'mailjet');
  if (message.subject.length > MAX_SUBJECT) {
    throw new RangeError(`Mailjet takes a subject of at most ${MAX_SUBJECT} characters.`);
  }
  if (recipientCount(message) > MAX_RECIPIENTS) {
    throw new RangeError(`Mailjet takes at most ${MAX_RECIPIENTS} recipients a message.`);
  }
  if (message.replyRecipients.length > 1) {
    throw new RangeError('Mailjet takes one reply-to address.');
  }
  if (message.tags.length > 1) throw new RangeError('Mailjet takes one tag per message.');
};

const trackingOf = (message, config, hasHtml) => {
  const tracking = {};
  // Mailjet refuses both without an HTML part to track.
  if (!hasHtml) return tracking;
  const opens = message.tracking?.opens ?? config.openTracking;
  const clicks = message.tracking?.clicks ?? config.clickTracking;
  if (opens !== undefined) tracking.TrackOpens = opens ? 'enabled' : 'disabled';
  if (clicks !== undefined) tracking.TrackClicks = clicks ? 'enabled' : 'disabled';
  return tracking;
};

/**
 * Converts a message to an entry of Mailjet's `Messages`.
 *
 * @param message The message.
 * @param config The configuration.
 * @param signal Cancels the reads of the attachments.
 * @returns The entry.
 * @throws {RangeError} If the message is over a limit of Mailjet, or gives a
 * field Mailjet sets itself.
 * @throws {TypeError} If it is scheduled.
 */
const convertMessage = async (message, config, signal) => {
  checkLimits(message);
  const entry = {
    From: addressOf(message.sender),
    To: addressesOf(message.recipients),
    Subject: message.subject,
  };
  if (message.ccRecipients.length > 0) entry.Cc = addressesOf(message.ccRecipients);
  if (message.bccRecipients.length > 0) entry.Bcc = addressesOf(message.bccRecipients);
  if (message.replyRecipients.length === 1) entry.ReplyTo = addressOf(message.replyRecipients[0]);
  const hasHtml = 'html' in message.content;
  if (message.content.text) entry.TextPart = message.content.text;
  if (hasHtml) entry.HTMLPart = message.content.html;
  const headers = {};
  let hasHeaders = false;
  for (const field of headerFieldsOf(message)) {
    if (FORBIDDEN_HEADERS.has(field.name.toLowerCase())) {
      throw new RangeError(`Mailjet sets ${field.name} itself; the message cannot give it.`);
    }
    headers[field.name] = field.value;
    hasHeaders = true;
  }
  if (hasHeaders) entry.Headers = headers;
  if (message.tags.length === 1) entry.CustomCampaign = message.tags[0];
  if (message.metadata !== undefined) entry.EventPayload = JSON.stringify(message.metadata);
  Object.assign(entry, trackingOf(message, config, hasHtml));
  const attachments = await base64Attachments(message, signal);
  for (const item of attachments) {
    const part = {
      ContentType: item.attachment.contentType,
      Filename: item.attachment.filename,
      Base64Content: item.content,
    };
    if (item.attachment.inline) {
      part.ContentID = item.attachment.contentId;
      entry.InlinedAttachments ??= [];
      entry.InlinedAttachments.push(part);
    } else {
      entry.Attachments ??= [];
      entry.Attachments.push(part);
    }
  }
  return entry;
};

module.exports = { MAX_RECIPIENTS, convertMessage, recipientCount };
