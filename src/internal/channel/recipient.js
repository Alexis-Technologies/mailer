// Not ported: the recipient of a message of a channel as one string, for what
// finds it (./mock) or keeps it out of a record (./logger, ./otel): its
// number or id, or the token, topic, endpoint or conversation its object
// names.

const { redactRecipients } = require('../redact-addresses.js');

const REDACTED = '[REDACTED]';
// A recipient shorter than this is not replaced as it is written: a chat 42
// would replace a status or a count of the text.
const MIN_RECIPIENT_LENGTH = 6;

/**
 * The recipient a `to` names, as a string.
 *
 * @returns Its number or id, or the token, topic, endpoint or conversation
 * of its object; `undefined` for a message without one.
 * @internal
 */
const recipientOf = (to) => {
  if (typeof to !== 'object' || to === null) return to === undefined ? undefined : String(to);
  return to.token ?? to.topic ?? to.endpoint ?? to.conversationId;
};

/**
 * Redacts the addresses and phone numbers of a text, and the recipient of
 * the message of a channel it is about, which an error of its provider may
 * name though it is no phone number: a chat id, a token, an endpoint.
 *
 * @param text The text.
 * @param message The message, of any channel, if the text is about one.
 * @internal
 */
const redactMessageRecipient = (text, message) => {
  const recipient = recipientOf(message?.to);
  const exact =
    recipient !== undefined && recipient.length >= MIN_RECIPIENT_LENGTH
      ? text.replaceAll(recipient, REDACTED)
      : text;
  return redactRecipients(exact);
};

module.exports = { recipientOf, redactMessageRecipient };
