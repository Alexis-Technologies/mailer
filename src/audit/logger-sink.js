// Not ported: an audit sink that writes each event as a record of the
// pino-like logger the application passes in: a failure at `error`, an
// unknown delivery, a bounce and a complaint at `warn`, the rest at `info`.

const { createLog } = require('../internal/log.js');

const DEFAULT_LEVELS = Object.freeze({
  queued: 'info',
  rendered: 'debug',
  submitted: 'debug',
  accepted: 'info',
  delivered: 'info',
  bounced: 'warn',
  complained: 'warn',
  failed: 'error',
  delivery_unknown: 'warn',
});

const LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

/**
 * Makes an audit sink of a logger.
 *
 * @param logger A pino-like logger.
 * @param options `levels`, the level of each state, over the defaults.
 * @returns The sink.
 * @throws {TypeError} If the logger is none or a level is unknown.
 */
const createLoggerAuditSink = (logger, options = {}) => {
  if (logger == null || typeof logger !== 'object') {
    throw new TypeError('createLoggerAuditSink needs a logger, such as pino().');
  }
  const levels = { ...DEFAULT_LEVELS, ...options.levels };
  for (const state of Object.keys(levels)) {
    if (!LEVELS.has(levels[state])) {
      throw new TypeError(`The level of ${state} must be one of a logger's: ${levels[state]}`);
    }
  }
  const log = createLog(logger, { component: 'audit' });
  return {
    append(event) {
      log.write(levels[event.state] ?? 'info', () => ({ ...event }), `mail.${event.state}`);
    },
  };
};

module.exports = { createLoggerAuditSink };
