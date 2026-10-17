// Not ported: the receipt of a message a provider cannot take as it is, which
// its converter refuses before any request: over a limit of the provider, or
// with a field it cannot express.

const { createFailedReceipt } = require('../core/receipt.js');

/**
 * The refusal of a converter, a RangeError that only a converter throws, so
 * that another, such as a body over its limit, keeps its own receipt.
 *
 * @internal
 */
class RefusalError extends RangeError {}

/**
 * The receipt of a refusal before any request, a non-retryable `validation`
 * failure, as for a message a transport cannot schedule; or `undefined` for
 * another error.
 *
 * @param provider The transport.
 * @param error What was thrown.
 * @returns The failed receipt, or `undefined`.
 * @internal
 */
const refusalFailure = (provider, error) =>
  error instanceof RefusalError
    ? createFailedReceipt(error.message, { provider, category: 'validation', retryable: false })
    : undefined;

module.exports = { RefusalError, refusalFailure };
