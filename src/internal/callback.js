// Not ported: a function the application passes to a decorator (a listener, a
// hook, a store) that throws: the send and its receipt go on, and the failure
// becomes a process warning rather than vanishing, as a logger's does.

const { redactAddresses } = require('./redact-addresses.js');
const { warnLimited } = require('./warn.js');

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
