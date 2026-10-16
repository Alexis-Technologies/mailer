// Ported from upyo v0.7.0 (packages/plunk/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { readAttachmentContent } = require('../core/attachment.js');
const { resolveThreadingHeaders } = require('../core/message-id.js');
const { createCalendarAttachment } = require('../core/calendar.js');
const { toBase64 } = require('../internal/base64.js');
const { lowerCaseNames } = require('../internal/headers.js');

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

const convertMessage = async (message, _config, signal) => {
  // Convert recipients - Plunk accepts either string or array
  const recipients = message.recipients.map((addr) => addr.address);
  const to = recipients.length === 1 ? recipients[0] : recipients;

  // Convert sender information
  const senderName = message.sender.name;
  const senderEmail = message.sender.address;

  // Convert reply-to (use first reply recipient)
  const replyTo =
    message.replyRecipients.length > 0 ? message.replyRecipients[0].address : undefined;

  // Convert content - HTML takes precedence over text
  let body;
  if ('html' in message.content && message.content.html) {
    body = message.content.html;
  } else if ('text' in message.content && message.content.text) {
    body = message.content.text;
  } else {
    body = '';
  }

  // Reply threading comes from the typed fields when the message defines them,
  // and from a custom header otherwise.  A field the message owns but left
  // empty writes nothing, which is how a caller drops an inherited header.
  const threading = resolveThreadingHeaders(message);
  const ownedHeaders = lowerCaseNames(threading.keys());

  // Convert headers - merge custom headers but exclude standard ones
  const customHeaders = {};
  if (message.headers) {
    for (const [key, value] of message.headers.entries()) {
      // Skip headers that are handled by dedicated fields
      const lowerKey = key.toLowerCase();
      if (!DEDICATED_HEADERS.has(lowerKey) && !ownedHeaders.has(lowerKey)) {
        customHeaders[lowerKey] = value;
      }
    }
  }
  for (const [name, value] of threading) {
    if (value != null) customHeaders[name] = value;
  }

  // A transport that cannot compose a `text/calendar` alternative carries the
  // scheduling payload as an *invite.ics* part instead, ahead of the caller's
  // own files so that a client looking for the first calendar part finds it.
  // Built here rather than inside the loop below, whose error handling drops a
  // part it cannot convert: an invitation must not disappear that quietly.
  const sourceAttachments =
    message.calendar == null
      ? message.attachments
      : [createCalendarAttachment(message.calendar), ...message.attachments];

  // Plunk documents a limit of five attachments, and quietly sending the first
  // five is only acceptable while nothing important is at the end.  Once the
  // invitation occupies a slot, going over the limit would silently drop one of
  // the caller's own files, so it is refused instead.
  if (message.calendar != null && sourceAttachments.length > 5) {
    throw new RangeError(
      'Plunk supports at most five attachments, and a calendar message needs ' +
        'one of them for the invitation.',
    );
  }

  // Convert attachments (limit to 5 as per Plunk documentation)
  const attachments = [];
  const maxAttachments = Math.min(sourceAttachments.length, 5);

  for (let i = 0; i < maxAttachments; i++) {
    const attachment = sourceAttachments[i];
    const convertedAttachment = await convertAttachment(attachment, signal);
    if (convertedAttachment) {
      attachments.push(convertedAttachment);
    }
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

  if (Object.keys(customHeaders).length > 0) {
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
 * @returns Promise that resolves to Plunk attachment or null if conversion fails
 */
const convertAttachment = async (attachment, signal) => {
  try {
    // Get content as Uint8Array
    const content = await readAttachmentContent(attachment.content, signal);

    // Convert to base64
    const base64Content = toBase64(content);

    return {
      filename: attachment.filename,
      content: base64Content,
      contentType: attachment.contentType,
    };
  } catch (error) {
    signal?.throwIfAborted();
    // Log error but don't fail the entire send operation
    // oxlint-disable-next-line no-console -- upstream
    console.warn(`Failed to convert attachment ${attachment.filename}:`, error);
    return null;
  }
};

module.exports = { convertMessage };
