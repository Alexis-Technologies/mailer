// Not ported: the checks of the options of the decorators, apart from those of
// the HTTP providers so that a decorator's bundle carries no URL checks.

/**
 * Checks an optional function.
 *
 * @internal
 */
const checkOptionalFunction = (value, name) => {
  if (value !== undefined && typeof value !== 'function') {
    throw new TypeError(`${name} must be a function.`);
  }
  return value;
};

/**
 * Checks a finite number above zero.
 *
 * @internal
 */
const checkPositiveNumber = (value, name) => {
  if (typeof value !== 'number' || !(value > 0) || value === Infinity) {
    throw new TypeError(`${name} must be a positive number: ${String(value)}`);
  }
  return value;
};

/**
 * Checks a whole number above zero.
 *
 * @internal
 */
const checkPositiveInteger = (value, name) => {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer: ${String(value)}`);
  }
  return value;
};

/**
 * Checks a whole number of zero or more.
 *
 * @internal
 */
const checkNonNegativeInteger = (value, name) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a whole number of zero or more: ${String(value)}`);
  }
  return value;
};

// What a queue keeps of the data of a finished job: all of it, that of the
// failed ones (for a retry by hand), or none.
const RETAIN_DATA = new Set(['all', 'failed', 'none']);

/**
 * Checks `retainData` of a queue, `'failed'` by default.
 *
 * @internal
 */
const checkRetainData = (value = 'failed') => {
  if (!RETAIN_DATA.has(value)) {
    throw new TypeError(`retainData must be 'all', 'failed' or 'none': ${String(value)}`);
  }
  return value;
};

module.exports = {
  checkNonNegativeInteger,
  checkRetainData,
  checkOptionalFunction,
  checkPositiveInteger,
  checkPositiveNumber,
};
