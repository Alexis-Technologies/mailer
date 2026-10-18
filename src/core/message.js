// Ported from upyo v0.7.0 (packages/core/src/message.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee
// Also ported from unemail v0.7.0 (src/core/message.ts): `scheduledAt`,
// `tracking` and `metadata`, checked here rather than by each provider.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const { generateId } = require('./id.js');
const { parseAddress } = require('./address.js');
const { isAttachment } = require('./attachment.js');
const { resolveCalendarContent } = require('./calendar.js');
const { parseMessageId } = require('./message-id.js');
const { addListHeaders } = require('./list.js');

/**
 * Creates a new email {@link Message} based on the provided constructor
 * parameters.  This function provides a more convenient API for creating
 * messages compared to constructing a {@link Message} object directly.
 *
 * @example
 * ```typescript
 * const message = createMessage({
 *   from: "sender@example.com",
 *   to: "recipient1@example.com",
 *   subject: "Hello World",
 *   content: { text: "This is a test message" }
 * });
 * ```
 *
 * @param constructor The constructor parameters for the message. Uses more
 *                    user-friendly types like accepting strings for email
 *                    addresses and `File` objects for attachments.
 * @param options `generateId`, which makes the left half of the Content-ID of
 *                a `File` attachment instead of a UUID.
 * @returns A new {@link Message} object with all properties normalized and
 *          validated.
 * @throws {TypeError} When any email address string cannot be parsed, when an
 *                     address or attachment carries a carriage return or line
 *                     feed that could forge header fields, when an attachment
 *                     object is invalid, when a message identifier is not
 *                     valid, when the date is not one RFC 5322 can express, or
 *                     when the calendar content is not a single well-formed
 *                     iCalendar object declaring one supported method, when a
 *                     field of `list` is invalid or also given in `headers`,
 *                     when `scheduledAt`, `tracking` or `metadata` is
 *                     invalid, or when `generateId` returns no dot-atom-text.
 */
const createMessage = (constructor, options) => {
  const sender = checkAddress('sender', constructor.from);
  return {
    sender,
    recipients: checkAddresses('recipient', constructor.to),
    ccRecipients: checkAddresses('CC', constructor.cc),
    bccRecipients: checkAddresses('BCC', constructor.bcc),
    replyRecipients: checkAddresses('reply-to', constructor.replyTo),
    attachments: checkAttachments(constructor.attachments, sender, options),
    subject: constructor.subject,
    content: constructor.content,
    priority: constructor.priority ?? 'normal',
    tags: ensureArray(constructor.tags),
    headers: addListHeaders(new Headers(constructor.headers ?? {}), constructor.list),
    idempotencyKey: constructor.idempotencyKey,
    messageId:
      constructor.messageId == null ? undefined : checkMessageId('', constructor.messageId),
    date: checkDate(constructor.date),
    inReplyTo: checkMessageIds('in-reply-to ', constructor.inReplyTo),
    references: checkMessageIds('references ', constructor.references),
    calendar:
      constructor.calendar == null ? undefined : resolveCalendarContent(constructor.calendar),
    scheduledAt: checkScheduledAt(constructor.scheduledAt),
    tracking: checkTracking(constructor.tracking),
    metadata: checkMetadata(constructor.metadata),
  };
};

const throwTypeError = (message) => {
  throw new TypeError(message);
};

/**
 * Normalizes an address and rejects one that could forge header fields.
 *
 * A transport that composes a message itself writes the address into a header
 * field as given, so a carriage return or line feed in it would end that field
 * and let the rest of the value appear as further fields.  The string form has
 * always been rejected by {@link parseAddress}; the object form used to pass
 * through unchecked.
 *
 * @param label How the address is described in the error message.
 * @param address The address, either an object or a string to parse.
 * @returns The normalized address.
 * @throws {TypeError} If the string cannot be parsed, or if the resulting
 * address contains a carriage return or line feed.
 */
const checkAddress = (label, address) => {
  const parsed =
    typeof address === 'string'
      ? (parseAddress(address) ??
        throwTypeError(`Invalid ${label} address: ${JSON.stringify(address)}`))
      : address;
  if (/[\r\n]/.test(parsed.address)) {
    throwTypeError(`Invalid ${label} address: ${JSON.stringify(parsed.address)}`);
  }
  if (parsed.name != null && /[\r\n]/.test(parsed.name)) {
    throwTypeError(`Invalid ${label} display name: it contains a carriage return or line feed.`);
  }
  return parsed;
};

// One address or several, none for `null` or `undefined`, each checked.
const checkAddresses = (label, value) => {
  const addresses = [];
  if (value == null) return addresses;
  if (!Array.isArray(value)) {
    addresses.push(checkAddress(label, value));
    return addresses;
  }
  for (const address of value) addresses.push(checkAddress(label, address));
  return addresses;
};

// One attachment or several, each a `File` (given a Content-ID on the domain
// of the sender) or an attachment object, each checked.
const checkAttachments = (value, sender, options) => {
  const attachments = [];
  for (const attachment of ensureArray(value)) {
    if (attachment instanceof File) {
      attachments.push(
        checkAttachment({
          inline: false,
          filename: attachment.name,
          content: attachment,
          contentType:
            attachment.type == null || attachment.type === ''
              ? 'application/octet-stream'
              : attachment.type,
          contentId: `${generateId('content-id', options?.generateId)}@${sender.address.replace(/^[^@]*@/, '')}`,
        }),
      );
    } else if (isAttachment(attachment)) {
      attachments.push(checkAttachment(attachment));
    } else {
      throwTypeError(`Invalid attachment: ${JSON.stringify(attachment)}`);
    }
  }
  return attachments;
};

/**
 * Rejects an attachment whose content type or content ID could forge header
 * fields.
 *
 * A transport that composes MIME itself writes both into the part headers as
 * given, so a carriage return or line feed in either would end that field and
 * let the rest of the value appear as further fields.  An uploaded file's
 * declared content type is routinely chosen by whoever uploaded it.
 *
 * @param attachment The attachment to check.
 * @returns The attachment, unchanged.
 * @throws {TypeError} If the content type or content ID contains a carriage
 * return or line feed.
 * @internal
 */
const checkAttachment = (attachment) => {
  if (/[\r\n]/.test(attachment.contentType)) {
    throwTypeError(`Invalid attachment content type: ${JSON.stringify(attachment.contentType)}`);
  }
  if (/[\r\n]/.test(attachment.contentId)) {
    throwTypeError(`Invalid attachment content ID: ${JSON.stringify(attachment.contentId)}`);
  }
  return attachment;
};

/**
 * Normalizes a message identifier, rejecting one that is not valid.
 *
 * A transport writes the identifier into a structured header field as given,
 * without the RFC 2047 encoding that neutralizes a carriage return or line feed
 * in a free-form value, so an invalid one has to be refused rather than
 * repaired.
 *
 * @param label How the identifier is described in the error message.
 * @param id The identifier, with or without the enclosing angle brackets.
 * @returns The identifier in its bare form.
 * @throws {TypeError} If the value is not a valid message identifier.
 */
const checkMessageId = (label, id) => {
  return parseMessageId(id) ?? throwTypeError(`Invalid ${label}message ID: ${JSON.stringify(id)}`);
};

/**
 * Normalizes a list of message identifiers, preserving the difference between
 * an absent list and an empty one: the first defers to a header supplied
 * through {@link MessageConstructor.headers}, while the second suppresses it.
 *
 * @param label How the identifiers are described in the error message.
 * @param ids One identifier, several, or none.
 * @returns The identifiers in their bare form, or `undefined` if none were
 *          given.
 * @throws {TypeError} If any value is not a valid message identifier.
 */
const checkMessageIds = (label, ids) => {
  if (ids == null) return undefined;
  if (typeof ids === 'string') return [checkMessageId(label, ids)];
  const checked = [];
  for (const id of ids) checked.push(checkMessageId(label, id));
  return checked;
};

/**
 * Checks an origination date and copies it, so that a later mutation of the
 * caller's `Date` cannot change what a retry sends.
 *
 * @param date The date to check, if any.
 * @returns A copy of the date, or `undefined` if none was given.
 * @throws {TypeError} If the date is invalid, or earlier than RFC 5322 §3.3
 * can express.
 */
const checkDate = (date) => {
  if (date == null) return undefined;
  const time = date instanceof Date ? date.getTime() : Number.NaN;
  if (Number.isNaN(time) || date.getUTCFullYear() < 1900) {
    throwTypeError(`Invalid date: ${JSON.stringify(date)}`);
  }
  return new Date(time);
};

const checkScheduledAt = (date) => {
  if (date == null) return undefined;
  const time = date instanceof Date ? date.getTime() : Number.NaN;
  if (Number.isNaN(time)) throwTypeError(`Invalid scheduledAt: ${JSON.stringify(date)}`);
  return new Date(time);
};

const checkTracking = (tracking) => {
  if (tracking == null) return undefined;
  if (typeof tracking !== 'object' || Array.isArray(tracking)) {
    throwTypeError('Invalid tracking: it must be an object of `opens` and `clicks`.');
  }
  const checked = {};
  for (const key in tracking) {
    if (!Object.hasOwn(tracking, key) || tracking[key] === undefined) continue;
    if (key !== 'opens' && key !== 'clicks') throwTypeError(`Invalid tracking field: ${key}`);
    if (typeof tracking[key] !== 'boolean') throwTypeError(`Invalid tracking.${key}: a boolean.`);
    checked[key] = tracking[key];
  }
  return Object.freeze(checked);
};

// A key may become the name of a header field (`X-Metadata-<key>`) or of a
// form field (`v:<key>`), so it holds no more than letters, digits, `_`, `-`
// and `.`; a value no control character.
const METADATA_KEY = /^[A-Za-z0-9_.-]{1,128}$/;
// Every provider bounds what it keeps (Postmark 10 fields of 80 characters,
// SendGrid 10,000 bytes); these bounds keep a value meant for an event from
// making a message of any size, and leave each provider's own to it.
const MAX_METADATA_KEYS = 64;
const MAX_METADATA_VALUE = 1024;

const hasControl = (text) => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};

const checkMetadata = (metadata) => {
  if (metadata == null) return undefined;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throwTypeError('Invalid metadata: it must be an object of strings.');
  }
  const checked = Object.create(null);
  let count = 0;
  for (const key in metadata) {
    if (!Object.hasOwn(metadata, key)) continue;
    if (++count > MAX_METADATA_KEYS) {
      throwTypeError(`Invalid metadata: more than ${MAX_METADATA_KEYS} keys.`);
    }
    if (!METADATA_KEY.test(key)) throwTypeError(`Invalid metadata key: ${JSON.stringify(key)}`);
    const value = metadata[key];
    if (typeof value !== 'string' || hasControl(value)) {
      throwTypeError(`Invalid metadata value of ${key}: a string without control characters.`);
    }
    if (value.length > MAX_METADATA_VALUE) {
      throwTypeError(`Invalid metadata value of ${key}: over ${MAX_METADATA_VALUE} characters.`);
    }
    checked[key] = value;
  }
  return Object.freeze(checked);
};

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
};

// The lists of addresses of a message and how its errors name them.
const ADDRESS_LISTS = [
  ['recipients', 'recipient'],
  ['ccRecipients', 'CC'],
  ['bccRecipients', 'BCC'],
  ['replyRecipients', 'reply-to'],
];

/**
 * Checks again what `createMessage` checks of a message already made, such
 * as one a hook of `./hooks` gives in place of another: a copy with fields
 * changed (`{ ...message, to }`) skips `createMessage`, and the transports
 * that rely on it would write what it refuses.
 *
 * @param message The message.
 * @throws {TypeError} If a field is one `createMessage` refuses.
 * @internal
 */
const checkMessage = (message) => {
  checkAddress('sender', message.sender);
  for (const [field, label] of ADDRESS_LISTS) {
    if (!Array.isArray(message[field])) throwTypeError(`Invalid ${field}: it must be an array.`);
    for (const address of message[field]) checkAddress(label, address);
  }
  if (!Array.isArray(message.attachments)) throwTypeError('Invalid attachments: not an array.');
  for (const attachment of message.attachments) {
    if (!isAttachment(attachment)) throwTypeError('Invalid attachment.');
    checkAttachment(attachment);
  }
  if (!(message.headers instanceof Headers)) throwTypeError('Invalid headers: not a Headers.');
  if (message.messageId != null) checkMessageId('', message.messageId);
  checkMessageIds('in-reply-to ', message.inReplyTo);
  checkMessageIds('references ', message.references);
  if (message.date !== undefined) checkDate(message.date);
  checkScheduledAt(message.scheduledAt);
  checkTracking(message.tracking);
  checkMetadata(message.metadata);
};

module.exports = { checkAttachment, checkMessage, createMessage };
