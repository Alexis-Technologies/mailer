// Not ported: what the HTTP providers added in 1.1 share, once rather than a
// copy in each: the client of api-client.js, and the conversion of a batch in
// which a message that cannot be converted fails alone, its attachments and
// header fields, and the steps of one send.

const { readAttachmentContent } = require('../core/attachment.js');
const { createFailedReceipt } = require('../core/receipt.js');
const { toBase64 } = require('./base64.js');
const { canonicalHeaderName } = require('./headers.js');
const { convertAttachments, visitCustomHeaders, withCalendarAttachment } = require('./provider.js');
const {
  ProviderApiError,
  createApiClient,
  isCallerAbort,
  parseAnswer,
  providerFailure,
  truncateErrorText,
} = require('./api-client.js');

/**
 * Converts each message of a batch, one that fails to convert failing alone.
 *
 * @param messages The messages.
 * @param convert Converts one message.
 * @param provider The provider's id, for the receipt of a failure.
 * @param signal Rethrows the caller's abort.
 * @returns `{ payloads, slots }`: a slot is the index of a payload, or the
 * receipt of a message that did not convert.
 * @internal
 */
const convertBatch = async (messages, convert, provider, signal) => {
  const payloads = [];
  const slots = [];
  for (let i = 0; i < messages.length; i++) {
    try {
      payloads.push(await convert(messages[i]));
      slots.push(payloads.length - 1);
    } catch (error) {
      if (isCallerAbort(error, signal)) throw error;
      slots.push(providerFailure(provider, error));
    }
  }
  return { payloads, slots };
};

/**
 * The receipts of a batch in the order of its messages: those of
 * `receiptOf(index)` for the payloads that were sent, and the failures of the
 * others.
 *
 * @internal
 */
const mergeBatch = function* (slots, receiptOf) {
  for (let i = 0; i < slots.length; i++) {
    yield typeof slots[i] === 'number' ? receiptOf(slots[i]) : slots[i];
  }
};

/**
 * Checks the credential a provider needs when the transport is made.
 *
 * @internal
 */
const checkCredential = (value, name, label) => {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`${label} needs ${name}.`);
  }
  return value;
};

/**
 * The attachments of a message, an iCalendar part among them, each with its
 * content in base64, read concurrently.
 *
 * @param message The message.
 * @param signal Cancels the reads.
 * @returns `{ attachment, content }` of each.
 * @internal
 */
const base64Attachments = (message, signal) =>
  convertAttachments(
    withCalendarAttachment(message),
    async (attachment, readSignal) => ({
      attachment,
      content: toBase64(await readAttachmentContent(attachment.content, readSignal)),
    }),
    signal,
  );

// The fields an API sets from its own parameters.
const STANDARD_HEADERS = new Set([
  'from',
  'to',
  'cc',
  'bcc',
  'reply-to',
  'subject',
  'content-type',
  'content-transfer-encoding',
  'mime-version',
]);
const isStandardHeader = (name) => STANDARD_HEADERS.has(name.toLowerCase());

const PRIORITY_HEADERS = {
  high: [
    ['X-Priority', '1'],
    ['X-MSMail-Priority', 'High'],
    ['Importance', 'High'],
  ],
  low: [
    ['X-Priority', '5'],
    ['X-MSMail-Priority', 'Low'],
    ['Importance', 'Low'],
  ],
};

/**
 * The header fields a provider is given besides those it sets itself: the
 * priority, the custom fields (List-* among them) and the threading fields,
 * names capitalized.
 *
 * @param message The message.
 * @returns `{ name, value }` of each.
 * @internal
 */
const headerFieldsOf = (message) => {
  const fields = [];
  const priority = PRIORITY_HEADERS[message.priority];
  if (priority !== undefined) {
    for (let i = 0; i < priority.length; i++) {
      fields.push({ name: priority[i][0], value: priority[i][1] });
    }
  }
  visitCustomHeaders(message, isStandardHeader, (name, value) => {
    fields.push({ name: canonicalHeaderName(name.toLowerCase()), value });
  });
  return fields;
};

/**
 * Sends one message of a provider: `convert(message, signal)`, then
 * `request(payload, options)`, then `receiptOf(answer)`.  The caller's abort
 * is thrown; any other failure is the receipt of `failureOf(error)`, the
 * provider's by default.
 *
 * @internal
 */
const sendConverted = async (message, options, steps) => {
  const signal = options?.signal;
  signal?.throwIfAborted();
  try {
    const payload = await steps.convert(message, signal);
    signal?.throwIfAborted();
    return steps.receiptOf(await steps.request(payload, options));
  } catch (error) {
    if (isCallerAbort(error, signal)) throw error;
    return steps.failureOf === undefined
      ? providerFailure(steps.provider, error)
      : steps.failureOf(error);
  }
};

/**
 * The receipt of an answer that should name the message: a success with its
 * id, or, without one, a failure of unknown delivery, as the provider took
 * the request.
 *
 * @internal
 */
const sentWith = (provider, messageId, missing) =>
  typeof messageId === 'string' && messageId !== ''
    ? { successful: true, messageId, provider }
    : createFailedReceipt(missing, { provider, deliveryUnknown: true });

module.exports = {
  ProviderApiError,
  base64Attachments,
  checkCredential,
  convertBatch,
  createApiClient,
  headerFieldsOf,
  isCallerAbort,
  mergeBatch,
  parseAnswer,
  providerFailure,
  sendConverted,
  sentWith,
  truncateErrorText,
};
