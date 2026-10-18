// Ported from unemail v0.7.0 (src/drivers/tee.ts): the options of the tee.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const {
  checkOptionalFunction,
  checkPositiveInteger,
  checkPositiveNumber,
} = require('../internal/options.js');

/**
 * Resolves the options of the tee.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createTeeConfig = (config = {}) => {
  const mirrors = config.mirrors;
  if (!Array.isArray(mirrors) || mirrors.length === 0) {
    throw new TypeError('mirrors must be a non-empty array of transports.');
  }
  for (const mirror of mirrors) {
    if (typeof mirror?.send !== 'function') {
      throw new TypeError('Every mirror must be a transport with a send method.');
    }
  }
  const awaitMirrors = config.awaitMirrors ?? false;
  if (typeof awaitMirrors !== 'boolean') {
    throw new TypeError('awaitMirrors must be a boolean.');
  }
  return {
    mirrors: [...mirrors],
    timeout: checkPositiveNumber(config.timeout ?? 10000, 'timeout'),
    awaitMirrors,
    maxPending: checkPositiveInteger(config.maxPending ?? 100, 'maxPending'),
    onMirror: checkOptionalFunction(config.onMirror, 'onMirror'),
    logger: config.logger,
  };
};

module.exports = { createTeeConfig };
