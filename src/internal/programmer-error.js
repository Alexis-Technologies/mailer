// Not ported: tells a bug in code, such as reading a property of undefined,
// from a failure of delivery, for the decorators that rethrow the one and
// report the other.

const { classifyReceiptError } = require('../core/receipt.js');

// The built-in errors of a bug in code, as opposed to a failure of delivery.
// A network failure is also a TypeError under fetch ("fetch failed"), but its
// causes classify it.
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

module.exports = { isProgrammerError };
