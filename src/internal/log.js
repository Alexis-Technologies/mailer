// Not ported: the logging of what happens inside a transport, through
// the pino-like logger the application passes in.  Without one a transport
// writes nothing, except the warnings of warnDegradation.

/**
 * Makes the log of a component: the logger bound to `bindings` through
 * `child()` when it has one, or with them merged into each record otherwise.
 * A record is built only for a level the logger would write, and a logger
 * that throws changes nothing of a send: its failure becomes a process
 * warning.
 *
 * @param logger The logger of the application, if any.
 * @param bindings The properties of every record, such as `{ transport }`.
 * @returns The log of the component.
 * @internal
 */
const createLog = (logger, bindings) => {
  if (logger == null) return SILENT;
  const bound = typeof logger.child === 'function' ? logger.child(bindings) : logger;
  const merge = bound === logger;
  const isEnabled = (level) =>
    typeof bound[level] === 'function' && (bound.isLevelEnabled?.(level) ?? true);
  return {
    hasLogger: true,
    isEnabled,
    /**
     * Writes a record, its properties given as an object or as a function
     * that builds them, called only when the level is written.
     */
    write(level, properties, message) {
      if (!isEnabled(level)) return;
      const built = typeof properties === 'function' ? properties() : properties;
      try {
        bound[level](merge ? { ...bindings, ...built } : built, message);
      } catch (error) {
        process.emitWarning(`A logger passed to the mailer threw: ${error?.message ?? error}`, {
          code: 'MAILER_LOGGER_FAILED',
        });
      }
    },
  };
};

const SILENT = Object.freeze({
  hasLogger: false,
  isEnabled: () => false,
  write: () => {},
});

/**
 * Warns that mail goes out with less protection than was asked for, such as
 * without TLS or without its DKIM signature: through the logger when there is
 * one, through `console.warn` otherwise, as the one thing a transport writes
 * without a logger.
 *
 * @param log The log of the component.
 * @param code The code of the warning, such as `MAILER_SMTP_PLAINTEXT`.
 * @param message What happened.
 * @param properties More properties of the record.
 * @internal
 */
const warnDegradation = (log, code, message, properties) => {
  if (log.hasLogger) {
    log.write('warn', () => ({ code, ...properties }), message);
    return;
  }
  // oxlint-disable-next-line no-console -- mail sent with less protection than asked, without a logger to tell
  console.warn(`${code}: ${message}`);
};

module.exports = { createLog, warnDegradation };
