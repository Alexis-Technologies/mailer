// Ported from upyo v0.7.0 (packages/plunk/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { toAsciiAddress } = require('../core/address.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { toBase64 } = require('../internal/base64.js');
const { collectCustomHeaders, withCalendarAttachment } = require('../internal/provider.js');
const { refuseScheduledAt } = require('../internal/schedule.js');
const { RefusalError } = require('../internal/refusal.js');

/**
 * Converts a Upyo message to Plunk API format.
 *
 * This function transforms the standardized Upyo message format into the
 * format expected by the Plunk HTTP API, handling email addresses,
 * content conversion, attachments, and headers.
 *
 * @param message - The Upyo message to convert
 * @param config - Resolved Plunk configuration
 * @returns Promise that resolves to Plunk-formatted email data
 * @throws {TypeError} If the message carries an invalid message identifier, or
 *                     calendar content that is not a single well-formed
 *                     iCalendar object.
 * @throws {RangeError} If a calendar message carries so many attachments that
 *                      one would have to be dropped.
 */
// The headers that have fields of their own in a Plunk request.
const DEDICATED_HEADERS = new Set(['to', 'from', 'reply-to', 'subject', 'content-type']);
const isDedicatedHeader = (name) => DEDICATED_HEADERS.has(name.toLowerCase());

const addressesOf = (message) => {
  const addresses = [];
  for (const recipient of message.recipients) addresses.push(toAsciiAddress(recipient.address));
  return addresses;
};

const convertMessage = async (message, _config, signal) => {
  refuseScheduledAt(message, 'plunk');
  // Convert recipients - Plunk accepts either string or array
  const to =
    message.recipients.length === 1
      ? toAsciiAddress(message.recipients[0].address)
      : addressesOf(message);

  // Convert sender information
  const senderName = message.sender.name;
  const senderEmail = toAsciiAddress(message.sender.address);

  // Convert reply-to (use first reply recipient)
  const replyTo =
    message.replyRecipients.length > 0
      ? toAsciiAddress(message.replyRecipients[0].address)
      : undefined;

  // Convert content - HTML takes precedence over text
  let body;
  if ('html' in message.content && message.content.html) {
    body = message.content.html;
  } else if ('text' in message.content && message.content.text) {
    body = message.content.text;
  } else {
    body = '';
  }

  // The names of the custom headers come lower-cased from Headers.
  const customHeaders = collectCustomHeaders(message, isDedicatedHeader);

  // A transport that cannot compose a `text/calendar` alternative carries the
  // scheduling payload as an *invite.ics* part instead, ahead of the caller's
  // own files so that a client looking for the first calendar part finds it.
  // Built here rather than inside the loop below, whose error handling drops a
  // part it cannot convert: an invitation must not disappear that quietly.
  const sourceAttachments = withCalendarAttachment(message);

  // Plunk documents a limit of five attachments, and quietly sending the first
  // five is only acceptable while nothing important is at the end.  Once the
  // invitation occupies a slot, going over the limit would silently drop one of
  // the caller's own files, so it is refused instead.
  if (message.calendar != null && sourceAttachments.length > 5) {
    throw new RefusalError(
      'Plunk supports at most five attachments, and a calendar message needs ' +
        'one of them for the invitation.',
    );
  }

  // Convert attachments (limit to 5 as per Plunk documentation).  One that
  // cannot be read fails the send, as on the other providers: upstream left
  // it out with a console.warn, and the message went without it.
  const attachments = [];
  const maxAttachments = Math.min(sourceAttachments.length, 5);

  for (let i = 0; i < maxAttachments; i++) {
    attachments.push(await convertAttachment(sourceAttachments[i], signal));
  }

  // Build Plunk email object
  const plunkEmail = {
    to,
    subject: message.subject,
    body,
  };

  // Add optional fields if present
  if (senderName) {
    plunkEmail.name = senderName;
  }

  if (senderEmail) {
    plunkEmail.from = senderEmail;
  }

  if (replyTo) {
    plunkEmail.reply = replyTo;
  }

  if (customHeaders !== undefined) {
    plunkEmail.headers = customHeaders;
  }

  if (attachments.length > 0) {
    plunkEmail.attachments = attachments;
  }

  return plunkEmail;
};

/**
 * Converts a Upyo attachment to Plunk format.
 *
 * @param attachment - The Upyo attachment to convert
 * @returns Promise that resolves to Plunk attachment
 * @throws The error of reading its content.
 */
const convertAttachment = async (attachment, signal) => {
  const content = await readAttachmentContent(attachment.content, signal);
  return {
    filename: attachment.filename,
    content: toBase64(content),
    contentType: attachment.contentType,
  };
};

module.exports = { convertMessage };
