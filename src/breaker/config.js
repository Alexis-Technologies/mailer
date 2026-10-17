// Ported from unemail v0.7.0 (src/middleware/circuit-breaker.ts): the options
// of the circuit breaker.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const checkFunction = (value, name) => {
  if (value !== undefined && typeof value !== 'function') {
    throw new TypeError(`${name} must be a function.`);
  }
  return value;
};

/**
 * Resolves the options of the circuit breaker.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createBreakerConfig = (config = {}) => {
  const failureThreshold = config.failureThreshold ?? 5;
  if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
    throw new TypeError(`failureThreshold must be a positive integer: ${String(failureThreshold)}`);
  }
  const resetTimeoutMs = config.resetTimeoutMs ?? 30000;
  if (typeof resetTimeoutMs !== 'number' || !(resetTimeoutMs > 0) || resetTimeoutMs === Infinity) {
    throw new TypeError(`resetTimeoutMs must be a positive number: ${String(resetTimeoutMs)}`);
  }
  return {
    failureThreshold,
    resetTimeoutMs,
    isFailure: checkFunction(config.isFailure, 'isFailure'),
    onStateChange: checkFunction(config.onStateChange, 'onStateChange'),
    now: checkFunction(config.now, 'now') ?? Date.now,
  };
};

module.exports = { checkFunction, createBreakerConfig };
