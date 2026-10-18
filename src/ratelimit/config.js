// Ported from unemail v0.7.0 (src/middleware/rate-limit.ts): the options of
// the token bucket.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const {
  checkOptionalFunction,
  checkPositiveInteger,
  checkPositiveNumber,
} = require('../internal/options.js');

// A store of the buckets the processes of an application share.
const checkStore = (store) => {
  if (store === undefined) return undefined;
  if (typeof store?.take !== 'function') throw new TypeError('store must have a take method.');
  return store;
};

// The intervals are measured on a clock no change of the time of day moves.
const monotonic = () => performance.now();

/**
 * Resolves the options of the rate limiter.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createRateLimitConfig = (config = {}) => {
  const limit = checkPositiveNumber(config.limit, 'limit');
  const mode = config.mode ?? 'wait';
  if (mode !== 'wait' && mode !== 'reject') {
    throw new TypeError(`mode must be 'wait' or 'reject': ${String(mode)}`);
  }
  const maxWaitMs = config.maxWaitMs ?? 30000;
  if (typeof maxWaitMs !== 'number' || !(maxWaitMs >= 0)) {
    throw new TypeError(`maxWaitMs must be a non-negative number: ${String(maxWaitMs)}`);
  }
  return {
    limit,
    intervalMs: checkPositiveNumber(config.intervalMs ?? 1000, 'intervalMs'),
    burst: checkPositiveNumber(config.burst ?? limit, 'burst'),
    mode,
    maxWaitMs,
    key: checkOptionalFunction(config.key, 'key'),
    cost: checkOptionalFunction(config.cost, 'cost'),
    maxKeys: checkPositiveInteger(config.maxKeys ?? 10000, 'maxKeys'),
    now: checkOptionalFunction(config.now, 'now') ?? monotonic,
    logger: config.logger,
    store: checkStore(config.store),
  };
};

module.exports = { createRateLimitConfig };
