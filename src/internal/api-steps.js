// Not ported: what a provider of any channel shares of the HTTP providers of
// 1.1, apart from the conversions of an email message in api.js: the steps of
// one send, the receipts of a batch in the order of its messages, and the
// check of a credential, so that a provider of a channel takes them without
// the address, attachment and calendar code of email.

const { createFailedReceipt } = require('../core/receipt.js');
const { isCallerAbort } = require('./abort.js');
const { providerFailure } = require('./api-client.js');

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
    : createFailedReceipt(missing, { provider, category: 'unknown', deliveryUnknown: true });

module.exports = { checkCredential, mergeBatch, sendConverted, sentWith };
