// Not ported: what a decorator makes of an error a transport threw, rather
// than reported in a receipt: a bug in code, rethrown, or a failure of
// delivery, turned into a failed receipt.

const {
  classifyReceiptError,
  createFailedReceipt,
  createReceiptError,
} = require('../core/receipt.js');
const { isReceiptError } = require('./backoff.js');
const { isProgrammerError } = require('./programmer-error.js');
const { messageOf } = require('./decorator.js');

/**
 * The failed receipt of an error a transport threw: the receipt error it is,
 * or one classified from it, an `AbortError` a retryable timeout.
 *
 * @param error What was thrown.
 * @param providerId The provider the receipt names when the error names none.
 * @param attempts The attempts made, if counted.
 * @returns The failed receipt.
 * @internal
 */
const receiptOfThrown = (error, providerId, attempts) => {
  if (isReceiptError(error)) {
    const receiptError = error;
    return createFailedReceipt(receiptError, {
      provider: receiptError.provider ?? providerId,
      attempts,
    });
  }
  const classification =
    error instanceof Error && error.name === 'AbortError'
      ? { category: 'timeout', code: 'timeout', retryable: true }
      : classifyReceiptError(error);
  return createFailedReceipt(
    createReceiptError(messageOf(error), {
      provider: providerId,
      category: classification.category,
      code: classification.code,
      retryable: classification.retryable,
    }),
    { provider: providerId, attempts },
  );
};

module.exports = { isProgrammerError, receiptOfThrown };
