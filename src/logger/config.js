// Ported from upyo v0.7.0 (packages/logtape/src/config.ts), adapted to a
// pino-like logger passed in: pino's level names, and no LogTape category.
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/** The level names of pino (LogTape's `warning` is pino's `warn`). */
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

/**
 * Resolves logger transport options with their defaults.
 *
 * @param options User-provided transport options.
 * @returns Fully resolved transport options.
 * @throws {TypeError} If the logger is missing, a level is not one of pino's,
 *                     or the logger has no method for a configured level (that
 *                     of the retries only when a transport is wrapped).
 */
const resolveLoggerTransportOptions = (options) => {
  const { logger } = options;
  if (logger == null || (typeof logger !== 'object' && typeof logger !== 'function')) {
    throw new TypeError(
      'Expected a logger: an object with a method per level, such as a pino logger.',
    );
  }
  const levels = {
    sending: options.levels?.sending ?? 'debug',
    sent: options.levels?.sent ?? 'info',
    failed: options.levels?.failed ?? 'error',
    retrying: options.levels?.retrying ?? 'warn',
  };
  for (const [event, level] of Object.entries(levels)) {
    // Only a wrapped transport retries, so a log-only transport needs no
    // method for the retries.
    if (event === 'retrying' && options.transport == null) continue;
    if (!LEVELS.includes(level)) {
      throw new TypeError(
        `Expected levels.${event} to be one of ${LEVELS.join(', ')}: ${JSON.stringify(level)}`,
      );
    }
    if (typeof logger[level] !== 'function') {
      throw new TypeError(`Expected the logger to have a ${level}() method for levels.${event}.`);
    }
  }
  return {
    transport: options.transport,
    logger,
    recordMessage: options.recordMessage ?? false,
    levels,
    generateId: options.generateId,
  };
};

module.exports = { resolveLoggerTransportOptions };
