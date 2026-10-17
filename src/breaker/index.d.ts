// Types ported from unemail v0.7.0 (src/middleware)
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

/// <reference lib="esnext.disposable" />

import type {
  Logger,
  Message,
  RawMessage,
  RawTransport,
  Receipt,
  Transport,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

/**
 * `closed` lets every send through, `open` answers each at once, and
 * `half-open` lets one probe through to learn whether the provider is back.
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * The options of {@link CircuitBreakerTransport}.
 */
export interface CircuitBreakerConfig {
  /**
   * The failures in a row that open the circuit.
   * @default 5
   */
  readonly failureThreshold?: number;
  /**
   * How long the circuit stays open before it lets a probe through, in
   * milliseconds.
   * @default 30000
   */
  readonly resetTimeoutMs?: number;
  /**
   * How long a probe may take before it counts as a failure, the circuit
   * opening again, in milliseconds.
   * @default resetTimeoutMs
   */
  readonly probeTimeoutMs?: number;
  /**
   * Whether a receipt counts as a failure of the provider.  By default a
   * failed receipt counts when one of its errors is of the category
   * `network`, `timeout`, `server-error` or `service-unavailable`; a refused
   * message, a rate limit or a caller's abort says nothing of its health.
   * A thrown error, other than the caller's abort, always counts, once for
   * a batch.  One that throws is a process warning, and the receipt is
   * judged as by default.
   */
  readonly isFailure?: (receipt: Receipt) => boolean;
  /**
   * Hears every change of state; one that throws becomes a process warning
   * (`MAILER_BREAKER_LISTENER_FAILED`).
   */
  readonly onStateChange?: (state: CircuitState, previous: CircuitState) => void;
  /** The clock, in milliseconds. */
  readonly now?: () => number;
  /**
   * A pino-like logger: it hears a change of state, at `warn` when the circuit opens, `info`
   * otherwise, and a refused send at `debug`, each with its `code`.
   */
  readonly logger?: Logger;
}

/**
 * The options of {@link CircuitBreakerTransport}, with their defaults.
 */
export interface ResolvedCircuitBreakerConfig {
  readonly failureThreshold: number;
  readonly resetTimeoutMs: number;
  readonly probeTimeoutMs: number;
  readonly isFailure?: (receipt: Receipt) => boolean;
  readonly onStateChange?: (state: CircuitState, previous: CircuitState) => void;
  readonly now: () => number;
}

/**
 * A transport that stops sending through the one it wraps after it failed
 * `failureThreshold` times in a row.  While open, a send is answered at once
 * with a retryable `service-unavailable` receipt (code `breaker.open`) and
 * the time left in `retryAfterMilliseconds`, which `./pool` fails over with
 * and `./retry` waits for; after `resetTimeoutMs` one probe goes through,
 * whose success closes the circuit and whose failure opens it again.  The
 * state is that of the instance.
 *
 * @example
 * ```js
 * const { CircuitBreakerTransport } = require('@alexify/mailer/breaker');
 * const guarded = new CircuitBreakerTransport(transport, { failureThreshold: 5 });
 * ```
 */
export declare class CircuitBreakerTransport<TProviderId extends string = string>
  implements RawTransport<TProviderId>, VerifiableTransport<TProviderId>, AsyncDisposable
{
  readonly id: TProviderId;
  /** The resolved options. */
  readonly config: ResolvedCircuitBreakerConfig;
  /**
   * @param transport The transport to guard.
   * @param config The options.
   * @throws {TypeError} If an option is invalid.
   */
  constructor(transport: Transport<TProviderId>, config?: CircuitBreakerConfig);
  /** The state of the circuit, `half-open` when the next send would be a probe. */
  readonly state: CircuitState;
  /** Sends one message, unless the circuit is open. */
  send(message: Message, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Sends a raw message, unless the circuit is open.  A wrapped transport
   * without `sendRaw()` gives a failed receipt of the category
   * `configuration`.
   */
  sendRaw(message: RawMessage, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Sends messages through the `sendMany()` of the wrapped transport while the
   * circuit is closed; one read while it is open is answered at once, the
   * receipts in the order of the messages.
   */
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<TProviderId>>;
  /** Verifies the wrapped transport, whatever the state of the circuit. */
  verify(options?: TransportOptions): Promise<void>;
  /** Disposes of the wrapped transport when it supports disposal. */
  [Symbol.asyncDispose](): Promise<void>;
}
