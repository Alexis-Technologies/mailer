// Ported from unemail v0.7.0 (src/middleware/circuit-breaker.ts): the options
// of the circuit breaker.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const {
  checkOptionalFunction,
  checkPositiveInteger,
  checkPositiveNumber,
} = require('../internal/options.js');

/**
 * Resolves the options of the circuit breaker.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createBreakerConfig = (config = {}) => ({
  failureThreshold: checkPositiveInteger(config.failureThreshold ?? 5, 'failureThreshold'),
  resetTimeoutMs: checkPositiveNumber(config.resetTimeoutMs ?? 30000, 'resetTimeoutMs'),
  // A probe that has not answered by then is taken for a failure, so that a
  // send that hangs cannot hold the circuit half-open for good.
  probeTimeoutMs: checkPositiveNumber(
    config.probeTimeoutMs ?? config.resetTimeoutMs ?? 30000,
    'probeTimeoutMs',
  ),
  isFailure: checkOptionalFunction(config.isFailure, 'isFailure'),
  onStateChange: checkOptionalFunction(config.onStateChange, 'onStateChange'),
  now: checkOptionalFunction(config.now, 'now') ?? Date.now,
  logger: config.logger,
});

module.exports = { createBreakerConfig };
