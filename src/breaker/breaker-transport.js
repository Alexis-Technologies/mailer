// Ported from unemail v0.7.0 (src/middleware/circuit-breaker.ts): a circuit
// breaker that stops sending through a transport that keeps failing, and lets
// one probe through once it has waited.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: half-open lets exactly one probe through, where
// unemail let every send through while it was half-open; the circuit is that
// of the instance; only a failure of the provider counts (network, timeout,
// server error, unavailable), not a refused message or a caller's abort; and
// an open circuit answers with a retryable `service-unavailable` receipt
// carrying the time left, which `./pool` fails over with and `./retry` waits
// for; a probe that does not answer within `probeTimeoutMs` is a failure, a
// result counts only in the period of the circuit it was sent in, and a
// batch that throws counts once.

const { createFailedReceipt } = require('../core/receipt.js');
const { warnThrown } = require('../internal/callback.js');
const {
  disposeOf,
  isCallerAbort,
  refuseUnlessRaw,
  verifyWrapped,
} = require('../internal/decorator.js');
const { createLog } = require('../internal/log.js');
const { gatedSendMany } = require('../internal/gate.js');
const { createBreakerConfig } = require('./config.js');

// The categories that say the provider is failing rather than the message.
const FAILURE_CATEGORIES = new Set(['network', 'timeout', 'server-error', 'service-unavailable']);

const isProviderFailure = (receipt) => {
  if (receipt.successful) return false;
  for (const error of receipt.errors) {
    if (FAILURE_CATEGORIES.has(error.category)) return true;
  }
  return false;
};

/**
 * A transport that stops sending through the one it wraps after it failed
 * `failureThreshold` times in a row, answers at once while open, and after
 * `resetTimeoutMs` lets one probe through: its success closes the circuit,
 * its failure opens it again.
 */
class CircuitBreakerTransport {
  id;
  config;
  wrappedTransport;
  #state = 'closed';
  #failures = 0;
  #openedAt = 0;
  #probing = false;
  #probeAt = 0;
  // Grows at each change of state: a result counts only in the period it
  // was sent in, not in one the circuit came to since.
  #period = 0;
  #lastNow = 0;
  #log;

  /**
   * @param transport The transport to guard.
   * @param config `failureThreshold`, `resetTimeoutMs`, `isFailure`,
   * `onStateChange` and `now`.
   * @throws {TypeError} If an option is invalid.
   */
  constructor(transport, config) {
    this.wrappedTransport = transport;
    this.id = transport.id;
    this.config = createBreakerConfig(config);
    this.#log = createLog(this.config.logger, { transport: transport.id, decorator: 'breaker' });
  }

  /**
   * The state of the circuit: `closed`, `open`, or `half-open` when the next
   * send would be a probe.
   */
  get state() {
    if (this.#state === 'open' && this.#remaining() <= 0) return 'half-open';
    return this.#state;
  }

  // A clock that throws gives the last time it gave, never one of another
  // clock, which would put the intervals decades off.
  #now() {
    try {
      this.#lastNow = this.config.now();
    } catch (error) {
      warnThrown('The now of CircuitBreakerTransport', error, 'MAILER_BREAKER_LISTENER_FAILED');
    }
    return this.#lastNow;
  }

  /**
   * Sends one message, unless the circuit is open.
   *
   * @param message The message.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt of the wrapped transport, or that of an open circuit.
   */
  send(message, options) {
    return this.#guard(options, (sendOptions) => this.wrappedTransport.send(message, sendOptions));
  }

  /**
   * Sends a raw message, unless the circuit is open.  A wrapped transport
   * without `sendRaw()` gives a failed receipt of the category
   * `configuration`, which the circuit does not count.
   */
  async sendRaw(message, options) {
    const refusal = refuseUnlessRaw(this.wrappedTransport, options);
    if (refusal !== undefined) return refusal;
    return this.#guard(options, (sendOptions) =>
      this.wrappedTransport.sendRaw(message, sendOptions),
    );
  }

  /**
   * Sends messages through the `sendMany()` of the wrapped transport while
   * the circuit is closed; a message read while it is open is answered at
   * once, and one while it is half-open goes as its probe.
   */
  sendMany(messages, options) {
    // One error of the wrapped sendMany fails every message it held: it is one
    // failure of the provider, not as many as the messages.
    let counted;
    return gatedSendMany(this.wrappedTransport, messages, options, {
      admit: (message) => {
        const entry = this.#enter();
        return entry.refusal === undefined ? { message, ...entry } : entry.refusal;
      },
      settle: (receipt, admitted) => {
        this.#record(this.#counts(receipt), admitted);
        return receipt;
      },
      fail: (error, admitted) => {
        if (error === counted && !admitted.probe) return;
        counted = error;
        this.#thrown(error, options?.signal, admitted);
      },
      // Nothing is learned of a message left unanswered, but a probe frees
      // its place, or the circuit would refuse every send for good.
      abandon: (admitted) => {
        if (admitted.probe && admitted.period === this.#period) this.#probing = false;
      },
    });
  }

  /**
   * Verifies the wrapped transport, whatever the state of the circuit; it has
   * nothing to check when that transport cannot verify.
   */
  verify(options) {
    return verifyWrapped(this.wrappedTransport, options);
  }

  /**
   * Disposes of the wrapped transport when it supports explicit resource
   * management.
   */
  async [Symbol.asyncDispose]() {
    await disposeOf(this.wrappedTransport);
  }

  async #guard(options, send) {
    options?.signal?.throwIfAborted();
    const entry = this.#enter();
    if (entry.refusal !== undefined) return entry.refusal.receipt;
    let receipt;
    try {
      receipt = await send(options);
    } catch (error) {
      this.#thrown(error, options?.signal, entry);
      throw error;
    }
    this.#record(this.#counts(receipt), entry);
    return receipt;
  }

  #remaining() {
    return this.#openedAt + this.config.resetTimeoutMs - this.#now();
  }

  // Whether a send may go now, whether it is the probe, and the period of the
  // circuit it goes in.
  #enter() {
    if (this.#state === 'half-open' && this.#probing) {
      // A probe that has not answered in time failed: the circuit opens again.
      if (this.#now() - this.#probeAt >= this.config.probeTimeoutMs) {
        this.#probing = false;
        this.#open();
      }
    }
    if (this.#state === 'open') {
      const remaining = this.#remaining();
      if (remaining > 0) return { refusal: this.#refusal(remaining) };
      this.#transition('half-open');
    }
    if (this.#state === 'half-open') {
      if (this.#probing) return { refusal: this.#refusal(undefined) };
      this.#probing = true;
      this.#probeAt = this.#now();
      return { probe: true, period: this.#period };
    }
    return { probe: false, period: this.#period };
  }

  #refusal(remaining) {
    this.#log.write(
      'debug',
      () => ({ code: 'breaker.open', remaining }),
      'The circuit refused a send.',
    );
    const receipt = createFailedReceipt(
      `The circuit of ${this.id} is open after ${this.config.failureThreshold} failures in a ` +
        'row; the message was not sent.',
      {
        provider: this.id,
        category: 'service-unavailable',
        retryable: true,
        retryAfterMilliseconds: remaining === undefined ? undefined : Math.ceil(remaining),
        code: 'breaker.open',
      },
    );
    return { receipt };
  }

  // An isFailure that throws is a warning, and the receipt is judged as it
  // would be without it, rather than lost with the send.
  #counts(receipt) {
    if (this.config.isFailure === undefined) return isProviderFailure(receipt);
    try {
      return this.config.isFailure(receipt) === true;
    } catch (error) {
      warnThrown(
        'The isFailure of CircuitBreakerTransport',
        error,
        'MAILER_BREAKER_LISTENER_FAILED',
      );
      return isProviderFailure(receipt);
    }
  }

  #thrown(error, signal, entry) {
    if (isCallerAbort(error, signal)) {
      // The caller gave up: nothing is learned of the provider.
      if (entry.probe && entry.period === this.#period) this.#probing = false;
      return;
    }
    this.#record(true, entry);
  }

  // A result counts only in the period of the circuit it was sent in: a late
  // one of a send made before the circuit opened, or closed again, or of a
  // probe that ran out of time, decides nothing.
  #record(failed, entry) {
    if (entry.period !== this.#period) return;
    if (entry.probe) {
      this.#probing = false;
      if (failed) this.#open();
      else this.#close();
      return;
    }
    if (this.#state !== 'closed') return;
    if (!failed) {
      this.#failures = 0;
      return;
    }
    this.#failures++;
    if (this.#failures >= this.config.failureThreshold) this.#open();
  }

  #open() {
    this.#openedAt = this.#now();
    this.#failures = 0;
    this.#transition('open');
  }

  #close() {
    this.#failures = 0;
    this.#transition('closed');
  }

  #transition(state) {
    if (this.#state === state) return;
    const previous = this.#state;
    this.#state = state;
    this.#period++;
    this.#log.write(
      state === 'open' ? 'warn' : 'info',
      () => ({ code: `breaker.${state}`, previous }),
      `The circuit of ${this.id} is ${state}.`,
    );
    try {
      this.config.onStateChange?.(state, previous);
    } catch (error) {
      warnThrown(
        'The onStateChange of CircuitBreakerTransport',
        error,
        'MAILER_BREAKER_LISTENER_FAILED',
      );
    }
  }
}

module.exports = { CircuitBreakerTransport };
