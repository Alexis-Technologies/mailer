// Not ported: what the HTTP providers added in 1.1 share, once rather than a
// copy in each: the client of api-client.js, their attachments, addresses and
// header fields, and the steps of one send and the receipts of a batch of
// api-steps.js, which the providers of the channels take alone.

const { toAsciiAddress } = require('../core/address.js');
const { readAttachmentContent } = require('../core/attachment.js');
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
const { checkCredential, mergeBatch, sendConverted, sentWith } = require('./api-steps.js');

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
 * An address as a provider writes it: `{ [emailKey]: the address in A-labels,
 * [nameKey]: the name }`, the name only when there is one.
 *
 * @internal
 */
const mailboxOf = (address, emailKey, nameKey) => {
  const mailbox = { [emailKey]: toAsciiAddress(address.address) };
  if (address.name) mailbox[nameKey] = address.name;
  return mailbox;
};

/**
 * The addresses of a list, each as {@link mailboxOf} writes it.
 *
 * @internal
 */
const mailboxesOf = (addresses, emailKey, nameKey) => {
  const list = [];
  for (let i = 0; i < addresses.length; i++) list.push(mailboxOf(addresses[i], emailKey, nameKey));
  return list;
};

/**
 * Calls `visit(name, value)` with the `X-Metadata-<key>` header field of each
 * entry of the metadata of a message, for a provider that keeps none of its
 * own but gives the header fields back with its events.
 *
 * @internal
 */
const visitMetadataHeaders = (message, visit) => {
  if (message.metadata === undefined) return;
  for (const key in message.metadata) visit(`X-Metadata-${key}`, message.metadata[key]);
};

module.exports = {
  ProviderApiError,
  base64Attachments,
  checkCredential,
  createApiClient,
  headerFieldsOf,
  isCallerAbort,
  mailboxOf,
  mailboxesOf,
  mergeBatch,
  parseAnswer,
  providerFailure,
  sendConverted,
  sentWith,
  truncateErrorText,
  visitMetadataHeaders,
};
