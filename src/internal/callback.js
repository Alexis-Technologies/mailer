// Not ported: a function the application passes to a decorator (a listener, a
// hook, a store) that throws: the send and its receipt go on, and the failure
// becomes a process warning rather than vanishing, as a logger's does.

/**
 * Emits a process warning for a function of the application that threw.
 *
 * @param what What threw, such as "The onStateChange of CircuitBreakerTransport".
 * @param error What it threw.
 * @param code The code of the warning.
 * @internal
 */
const warnThrown = (what, error, code) => {
  process.emitWarning(`${what} threw: ${error instanceof Error ? error.message : String(error)}`, {
    code,
  });
};

module.exports = { warnThrown };
