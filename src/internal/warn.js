// Not ported: process warnings held to a few of each code a minute, so that
// a listener, a mirror or a logger that fails for every message does not
// fill the output of the process.

// No more than BURST warnings of a code go out a minute, and the first after
// it says how many were left out.
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

module.exports = { warnLimited };
