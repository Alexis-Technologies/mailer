// Not ported from upyo: what the message converters of the HTTP providers
// share, once in place of a copy in each provider.

const { combineSignals } = require('../core/abort-signal.js');
const { createCalendarAttachment } = require('../core/calendar.js');
const { resolveThreadingHeaders } = require('../core/message-id.js');
const { lowerCaseNames } = require('./headers.js');

/**
 * The attachments a provider sends.  A provider that cannot compose a
 * `text/calendar` alternative carries the scheduling payload as an
 * *invite.ics* part instead, ahead of the caller's own files, so that a
 * client looking for the first calendar part finds it.
 *
 * @param message The message being converted.
 * @returns The attachments, the calendar part first if there is one.
 * @internal
 */
const withCalendarAttachment = (message) => {
  if (message.calendar == null) return message.attachments;
  const attachments = [createCalendarAttachment(message.calendar)];
  for (const attachment of message.attachments) attachments.push(attachment);
  return attachments;
};

/**
 * Converts attachments in parallel, under a signal that stops the others as
 * soon as one fails or the caller aborts.
 *
 * @param attachments The attachments to convert.
 * @param convert Converts one attachment under a signal.
 * @param signal The caller's signal, if any.
 * @returns The converted attachments, in order.
 * @internal
 */
const convertAttachments = async (attachments, convert, signal) => {
  const cancellation = new AbortController();
  const combined = combineSignals(cancellation.signal, signal);
  try {
    const converting = [];
    for (const attachment of attachments) converting.push(convert(attachment, combined.signal));
    return await Promise.all(converting);
  } finally {
    cancellation.abort();
    combined.cleanup();
  }
};

/**
 * Visits the headers a provider sends as they are: the custom headers of a
 * message that the provider does not take through a field of its own and that
 * the typed threading fields do not own, then the threading fields the message
 * sets.  A threading field the message owns but left empty writes nothing,
 * which is how a caller drops an inherited header.
 *
 * @param message The message being converted.
 * @param isStandardHeader Whether the provider takes a header through a field.
 * @param visit Takes the name and the value of each header sent.
 * @internal
 */
const visitCustomHeaders = (message, isStandardHeader, visit) => {
  const threading = resolveThreadingHeaders(message);
  const ownedHeaders = lowerCaseNames(threading.keys());
  if (message.headers != null) {
    for (const [name, value] of message.headers) {
      if (!isStandardHeader(name) && !ownedHeaders.has(name.toLowerCase())) visit(name, value);
    }
  }
  for (const [name, value] of threading) {
    if (value != null) visit(name, value);
  }
};

/**
 * The headers {@link visitCustomHeaders} visits, as an object.
 *
 * @returns The headers by name, or `undefined` when there are none.
 * @internal
 */
const collectCustomHeaders = (message, isStandardHeader) => {
  let headers;
  visitCustomHeaders(message, isStandardHeader, (name, value) => {
    headers ??= {};
    headers[name] = value;
  });
  return headers;
};

/**
 * Formats each address of a list for a provider.
 *
 * @param addresses The addresses.
 * @param format Formats one address.
 * @returns The formatted addresses, in order.
 * @internal
 */
const formatAddresses = (addresses, format) => {
  const formatted = [];
  for (const address of addresses) formatted.push(format(address));
  return formatted;
};

module.exports = {
  collectCustomHeaders,
  convertAttachments,
  formatAddresses,
  visitCustomHeaders,
  withCalendarAttachment,
};
