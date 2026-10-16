// Ported from upyo v0.7.0 (packages/retry/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { sleep } = require('../internal/sleep.js');

/**
 * Creates a resolved retry configuration.
 *
 * @param config Retry configuration.
 * @returns The resolved configuration.
 * @throws {RangeError} If a numeric option is out of range.
 */
const createRetryConfig = (config = {}) => {
  const maxAttempts = config.maxAttempts ?? 3;
  const baseDelayMilliseconds = config.backoff?.baseDelayMilliseconds ?? 1000;
  const maxDelayMilliseconds = config.backoff?.maxDelayMilliseconds ?? 30000;
  const factor = config.backoff?.factor ?? 2;
  const maxConcurrent = config.sendMany?.maxConcurrent ?? 1;
  const intervalMilliseconds = config.sendMany?.intervalMilliseconds ?? 0;

  assertIntegerAtLeast(maxAttempts, 1, 'maxAttempts');
  assertFiniteAtLeast(baseDelayMilliseconds, 0, 'backoff.baseDelayMilliseconds');
  assertFiniteAtLeast(maxDelayMilliseconds, 0, 'backoff.maxDelayMilliseconds');
  assertFiniteAtLeast(factor, 1, 'backoff.factor');
  assertIntegerAtLeast(maxConcurrent, 1, 'sendMany.maxConcurrent');
  assertFiniteAtLeast(intervalMilliseconds, 0, 'sendMany.intervalMilliseconds');

  return {
    maxAttempts,
    backoff: {
      baseDelayMilliseconds,
      maxDelayMilliseconds,
      factor,
    },
    jitter: config.jitter ?? 'full',
    random: config.random ?? Math.random,
    shouldRetry: config.shouldRetry,
    generateId: config.generateId,
    logger: config.logger,
    wait: config.wait ?? defaultWait,
    sendMany: {
      maxConcurrent,
      intervalMilliseconds,
    },
  };
};

const defaultWait = async (context, signal) => {
  signal?.throwIfAborted();
  if (context.delayMilliseconds <= 0) return;
  await sleep(context.delayMilliseconds, signal);
};

const assertIntegerAtLeast = (value, minimum, name) => {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
};

const assertFiniteAtLeast = (value, minimum, name) => {
  if (!Number.isFinite(value) || value < minimum) {
    throw new RangeError(`${name} must be greater than or equal to ${minimum}.`);
  }
};

module.exports = { createRetryConfig };
