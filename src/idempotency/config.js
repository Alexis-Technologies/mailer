// Ported from unemail v0.7.0 (src/middleware/idempotency.ts): the options of
// the idempotency decorator.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const { checkOptionalFunction, checkPositiveNumber } = require('../internal/options.js');
const { createMemoryIdempotencyStore } = require('./memory-store.js');

const STORE_METHODS = ['reserve', 'complete', 'release'];

/**
 * Resolves the options of the idempotency decorator.
 *
 * @param config The options.
 * @param transportId The id of the wrapped transport, the default namespace.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createIdempotencyConfig = (config = {}, transportId) => {
  const store = config.store ?? createMemoryIdempotencyStore();
  for (const method of STORE_METHODS) {
    if (typeof store?.[method] !== 'function') {
      throw new TypeError(`store must have a ${method} method.`);
    }
  }
  const namespace = config.namespace ?? transportId;
  if (typeof namespace !== 'string') {
    throw new TypeError(`namespace must be a string: ${String(namespace)}`);
  }
  return {
    store,
    ttlMs: checkPositiveNumber(config.ttlMs ?? 24 * 60 * 60 * 1000, 'ttlMs'),
    key: checkOptionalFunction(config.key, 'key'),
    namespace,
  };
};

module.exports = { createIdempotencyConfig };
