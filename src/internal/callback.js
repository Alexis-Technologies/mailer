// Not ported: a function the application passes to a decorator (a listener, a
// hook, a store) that throws: the send and its receipt go on, and the failure
// becomes a process warning rather than vanishing, as a logger's does.

const { redactAddresses } = require('./redact-addresses.js');

// A listener or a mirror that fails for every message would fill the output
// of the process: no more than BURST warnings of a code go out a minute, and
// the first after it says how many were left out.
const BURST = 10;
const WINDOW_MS = 60 * 1000;
const periods = new Map();

/**
 * Emits a process warning, at most `BURST` of a code a minute.
 *
 * @param code The code of the warning.
 * @param text What it says.
 * @internal
 */
const warnLimited = (code, text) => {
  const now = performance.now();
  let period = periods.get(code);
  let said = text;
  if (period === undefined || now - period.start >= WINDOW_MS) {
    if (period !== undefined && period.skipped > 0) {
      said += ` (${period.skipped} more warnings of ${code} were left out in the last minute)`;
    }
    period = { start: now, count: 0, skipped: 0 };
    periods.set(code, period);
  }
  if (period.count >= BURST) {
    period.skipped++;
    return;
  }
  period.count++;
  process.emitWarning(said, { code });
};

/**
 * The text of what was thrown, with the addresses in it redacted: an SMTP
 * rejection or a store's error names a recipient, which no warning should.
 *
 * @internal
 */
const describeThrown = (error) =>
  redactAddresses(error instanceof Error ? error.message : String(error));

/**
 * Emits a process warning for a function of the application that threw.
 *
 * @param what What threw, such as "The onStateChange of CircuitBreakerTransport".
 * @param error What it threw.
 * @param code The code of the warning.
 * @internal
 */
const warnThrown = (what, error, code) => {
  warnLimited(code, `${what} threw: ${describeThrown(error)}`);
};

module.exports = { describeThrown, warnLimited, warnThrown };
