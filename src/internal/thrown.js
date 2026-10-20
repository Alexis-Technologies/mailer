// Not ported: what a decorator makes of an error a transport threw, rather
// than reported in a receipt: a bug in code, rethrown, or a failure of
// delivery, turned into a failed receipt.

const {
  classifyReceiptError,
  createFailedReceipt,
  createReceiptError,
} = require('../core/receipt.js');
const { isReceiptError } = require('./backoff.js');
const { messageOf } = require('./decorator.js');

// The built-in errors of a bug in code, such as reading a property of
// undefined, as opposed to a failure of delivery.  A network failure is also
// a TypeError under fetch ("fetch failed"), but its causes classify it.
const PROGRAMMER_ERRORS = [TypeError, RangeError, ReferenceError, SyntaxError];

/**
 * Whether an error is a bug in code rather than a failure of delivery: a
 * built-in error of a bug that `classifyReceiptError` does not recognize.
 *
 * @internal
 */
const isProgrammerError = (error) => {
  for (const type of PROGRAMMER_ERRORS) {
    if (error instanceof type) return classifyReceiptError(error).category === 'unknown';
  }
  return false;
};

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
