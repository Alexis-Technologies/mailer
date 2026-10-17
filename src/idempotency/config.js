// Ported from unemail v0.7.0 (src/middleware/idempotency.ts): the options of
// the idempotency decorator.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const { checkOptionalFunction, checkPositiveNumber } = require('../internal/options.js');
const { createMemoryIdempotencyStore } = require('./memory-store.js');

const STORE_METHODS = ['reserve', 'complete', 'release'];
// Longer than a send with all its attempts takes, so that a second send does
// not find the key free while the first is still out; short enough that a
// key a crash left reserved is taken again within minutes.
const DEFAULT_LEASE_MS = 10 * 60 * 1000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

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
    leaseMs: checkPositiveNumber(config.leaseMs ?? DEFAULT_LEASE_MS, 'leaseMs'),
    ttlMs: checkPositiveNumber(config.ttlMs ?? DEFAULT_TTL_MS, 'ttlMs'),
    key: checkOptionalFunction(config.key, 'key'),
    namespace,
    logger: config.logger,
  };
};

module.exports = { createIdempotencyConfig };
