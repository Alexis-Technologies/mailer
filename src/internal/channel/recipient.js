// Not ported: the recipient of a message of a channel as one string, for what
// finds it (./mock) or keeps it out of a record (./logger, ./otel): its
// number or id, or the token, topic, endpoint or conversation its object
// names.

const { redactRecipients } = require('../redact-addresses.js');

const REDACTED = '[REDACTED]';
// A recipient shorter than this is not replaced as it is written: a chat 42
// would replace a status or a count of the text.
const MIN_RECIPIENT_LENGTH = 6;
// A number in E.164, whose digits are replaced without their + too; eight at
// least, so that no count of a text is.
const E164 = /^\+[1-9]\d{7,14}$/;

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
 * name though it is no phone number (a chat id, a token, an endpoint), or
 * write as a number without its +.
 *
 * @param text The text.
 * @param message The message, of any channel, if the text is about one.
 * @internal
 */
const redactMessageRecipient = (text, message) => {
  const recipient = recipientOf(message?.to);
  let exact =
    recipient !== undefined && recipient.length >= MIN_RECIPIENT_LENGTH
      ? text.replaceAll(recipient, REDACTED)
      : text;
  // Most providers are sent a number without its +, and their errors echo
  // it so, which the pattern of redactRecipients, held to a +, misses.
  if (typeof recipient === 'string' && E164.test(recipient)) {
    exact = exact.replace(new RegExp(`(?<!\\d)${recipient.slice(1)}(?!\\d)`, 'g'), REDACTED);
  }
  return redactRecipients(exact);
};

module.exports = { recipientOf, redactMessageRecipient };
