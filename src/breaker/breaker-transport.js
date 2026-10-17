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
// for.

const { createFailedReceipt } = require('../core/receipt.js');
const { isRawTransport, isVerifiableTransport } = require('../core/transport.js');
const { warnThrown } = require('../internal/callback.js');
const { refuseRaw } = require('../internal/capabilities.js');
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

const isAbortOf = (error, signal) =>
  signal?.aborted === true && (error === signal.reason || error?.name === 'AbortError');

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
  }

  /**
   * The state of the circuit: `closed`, `open`, or `half-open` when the next
   * send would be a probe.
   */
  get state() {
    if (this.#state === 'open' && this.#remaining() <= 0) return 'half-open';
    return this.#state;
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
    if (!isRawTransport(this.wrappedTransport)) {
      options?.signal?.throwIfAborted();
      return refuseRaw(this.wrappedTransport);
    }
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
    return gatedSendMany(this.wrappedTransport, messages, options, {
      admit: (message) => {
        const entry = this.#enter();
        return entry.refusal === undefined ? { message, probe: entry.probe } : entry.refusal;
      },
      settle: (receipt, admitted) => {
        this.#record(this.#counts(receipt), admitted.probe);
        return receipt;
      },
      fail: (error, admitted) => this.#thrown(error, options?.signal, admitted.probe),
    });
  }

  /**
   * Verifies the wrapped transport, whatever the state of the circuit; it has
   * nothing to check when that transport cannot verify.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    if (isVerifiableTransport(this.wrappedTransport)) await this.wrappedTransport.verify(options);
  }

  /**
   * Disposes of the wrapped transport when it supports explicit resource
   * management.
   */
  async [Symbol.asyncDispose]() {
    const transport = Object(this.wrappedTransport);
    if (typeof transport[Symbol.asyncDispose] === 'function') {
      await transport[Symbol.asyncDispose]();
    } else if (typeof transport[Symbol.dispose] === 'function') {
      transport[Symbol.dispose]();
    }
  }

  async #guard(options, send) {
    options?.signal?.throwIfAborted();
    const entry = this.#enter();
    if (entry.refusal !== undefined) return entry.refusal.receipt;
    let receipt;
    try {
      receipt = await send(options);
    } catch (error) {
      this.#thrown(error, options?.signal, entry.probe);
      throw error;
    }
    this.#record(this.#counts(receipt), entry.probe);
    return receipt;
  }

  #remaining() {
    return this.#openedAt + this.config.resetTimeoutMs - this.config.now();
  }

  // Whether a send may go now, and whether it is the probe.
  #enter() {
    if (this.#state === 'open') {
      const remaining = this.#remaining();
      if (remaining > 0) return { refusal: this.#refusal(remaining) };
      this.#transition('half-open');
    }
    if (this.#state === 'half-open') {
      if (this.#probing) return { refusal: this.#refusal(undefined) };
      this.#probing = true;
      return { probe: true };
    }
    return { probe: false };
  }

  #refusal(remaining) {
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

  #counts(receipt) {
    return (this.config.isFailure ?? isProviderFailure)(receipt) === true;
  }

  #thrown(error, signal, probe) {
    if (isAbortOf(error, signal)) {
      // The caller gave up: nothing is learned of the provider.
      if (probe) this.#probing = false;
      return;
    }
    this.#record(true, probe);
  }

  // A result counts only in the state it was sent in: a late one of a send
  // made before the circuit opened decides nothing.
  #record(failed, probe) {
    if (probe) {
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
    this.#openedAt = this.config.now();
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
