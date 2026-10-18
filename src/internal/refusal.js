// Not ported: the receipts of what fails before a provider could take a
// message: a message its converter refuses before any request (over a limit of
// the provider, or with a field it cannot express), and a TLS certificate
// refused in the handshake.

const { createFailedReceipt, isCertificateFailure } = require('../core/receipt.js');
const { isDeliveryUnknown } = require('./delivery-unknown.js');

/**
 * The refusal of a converter, a RangeError that only a converter throws, so
 * that another, such as a body over its limit, keeps its own receipt.
 *
 * @internal
 */
class RefusalError extends RangeError {}

/**
 * The receipt of a refusal before any request, a non-retryable `unsupported`
 * failure: this transport cannot send the message as it is, and another one
 * may, so `./pool` fails over with it; or `undefined` for another error.
 *
 * @param provider The transport.
 * @param error What was thrown.
 * @returns The failed receipt, or `undefined`.
 * @internal
 */
const refusalFailure = (provider, error) =>
  error instanceof RefusalError
    ? createFailedReceipt(error.message, { provider, category: 'unsupported', retryable: false })
    : undefined;

/**
 * The receipt of a TLS certificate refused in the handshake, wrapped or not by
 * the provider's own error: a non-retryable `configuration` failure, as no
 * retry passes it; or `undefined` for another error.  An earlier attempt of
 * unknown delivery keeps the receipt so.
 *
 * @param provider The transport.
 * @param message The text of the receipt.
 * @param error What was thrown.
 * @returns The failed receipt, or `undefined`.
 * @internal
 */
const certificateFailure = (provider, message, error) =>
  isCertificateFailure(error)
    ? createFailedReceipt(message, {
        provider,
        category: 'configuration',
        code: 'configuration',
        retryable: false,
        deliveryUnknown: isDeliveryUnknown(error),
        attempts: Number.isInteger(error.attempts) ? error.attempts : undefined,
      })
    : undefined;

module.exports = { RefusalError, certificateFailure, refusalFailure };
