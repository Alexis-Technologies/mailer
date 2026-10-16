// Types ported from upyo v0.7.0 (packages/pool/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/// <reference lib="esnext.disposable" />

import { IdOptions, Message, Receipt, Transport, TransportOptions } from '../../index.js';

/**
 * Result of transport selection by a strategy.
 */
export interface TransportSelection<TProviderId extends string = string> {
  /**
   * The selected transport entry.
   */
  readonly entry: ResolvedTransportEntry<TProviderId>;
  /**
   * Index of the selected transport in the original list.
   */
  readonly index: number;
}
/**
 * Base interface for transport selection strategies.
 */
export interface Strategy<TProviderId extends string = string> {
  /**
   * Selects a transport for sending a message.
   *
   * @param message The message to send.
   * @param transports Available transports.
   * @param attemptedIndices Indices of transports that have already been
   *                         attempted.
   * @returns The selected transport or `undefined` if no suitable transport is
   *          available.
   */
  select(
    message: Message,
    transports: readonly ResolvedTransportEntry<TProviderId>[],
    attemptedIndices: ReadonlySet<number>,
  ): TransportSelection<TProviderId> | undefined;
  /**
   * Resets any internal state of the strategy.
   */
  reset(): void;
}

/**
 * Strategy for selecting transports in a pool.
 */
export type PoolStrategy = 'round-robin' | 'weighted' | 'priority' | 'selector-based';
/**
 * Function that determines if a transport should handle a specific message.
 */
export type TransportSelector = (message: Message) => boolean;
/**
 * Configuration for a transport entry in the pool.
 */
export interface TransportEntry<TProviderId extends string = string> {
  /**
   * The transport instance to use.
   */
  readonly transport: Transport<TProviderId>;
  /**
   * Weight for weighted distribution strategy.
   * Higher values mean more traffic. Defaults to 1.
   */
  readonly weight?: number;
  /**
   * Priority for priority-based failover strategy.
   * Higher values are tried first. Defaults to 0.
   */
  readonly priority?: number;
  /**
   * Selector function for selector-based routing.
   * If provided, this transport will only be used for messages
   * where the selector returns true.
   */
  readonly selector?: TransportSelector;
  /**
   * Whether this transport is enabled.
   * Disabled transports are skipped. Defaults to true.
   */
  readonly enabled?: boolean;
}
/**
 * Configuration options for the pool transport.
 */
export interface PoolConfig<TProviderId extends string = string> extends IdOptions {
  /**
   * The strategy to use for selecting transports.
   * Can be a built-in strategy name or a custom Strategy instance.
   */
  readonly strategy: PoolStrategy | Strategy<TProviderId>;
  /**
   * The transports in the pool.
   */
  readonly transports: readonly TransportEntry<TProviderId>[];
  /**
   * Maximum number of retry attempts after the initial send attempt fails.
   * Set to 0 to disable retries. Defaults to enough retries to try every
   * enabled transport once.
   */
  readonly maxRetries?: number;
  /**
   * Timeout in milliseconds for each send attempt.
   * If not specified, no timeout is applied.
   */
  readonly timeout?: number;
  /**
   * Whether to continue trying other transports after a successful send
   * when using selector-based strategy. Defaults to false.
   */
  readonly continueOnSuccess?: boolean;
  /**
   * The source of the random choices, a function like `Math.random` (for
   * tests, a deterministic one).
   * @default Math.random, read at each choice
   */
  readonly random?: () => number;
}
/**
 * Resolved pool configuration with defaults applied.
 */
export interface ResolvedPoolConfig<TProviderId extends string = string> {
  readonly strategy: PoolStrategy | Strategy<TProviderId>;
  readonly transports: readonly ResolvedTransportEntry<TProviderId>[];
  readonly maxRetries: number;
  readonly timeout?: number;
  readonly continueOnSuccess: boolean;
  readonly random?: () => number;
  readonly generateId?: IdOptions['generateId'];
}
/**
 * Resolved transport entry with defaults applied.
 */
export interface ResolvedTransportEntry<TProviderId extends string = string> {
  readonly transport: Transport<TProviderId>;
  readonly weight: number;
  readonly priority: number;
  readonly selector?: TransportSelector;
  readonly enabled: boolean;
}
/**
 * Creates a resolved pool configuration with defaults applied.
 *
 * @param config The pool configuration.
 * @returns The resolved configuration with defaults.
 * @throws {Error} If the configuration is invalid.
 */

/**
 * Pool transport that combines multiple transports with various load balancing
 * and failover strategies.
 *
 * This transport implements the same `Transport` interface, making it a drop-in
 * replacement for any single transport. It distributes messages across multiple
 * underlying transports based on the configured strategy.
 *
 * @example Round-robin load balancing
 * ```typescript
 * import { PoolTransport } from "@alexify/mailer/pool";
 *
 * const transport = new PoolTransport({
 *   strategy: "round-robin",
 *   transports: [
 *     { transport: mailgunTransport },
 *     { transport: sendgridTransport },
 *     { transport: sesTransport },
 *   ],
 * });
 * ```
 *
 * @example Priority-based failover
 * ```typescript
 * const transport = new PoolTransport({
 *   strategy: "priority",
 *   transports: [
 *     { transport: primaryTransport, priority: 100 },
 *     { transport: backupTransport, priority: 50 },
 *     { transport: lastResortTransport, priority: 10 },
 *   ],
 * });
 * ```
 *
 * @example Custom routing with selectors
 * ```typescript
 * const transport = new PoolTransport({
 *   strategy: "selector-based",
 *   transports: [
 *     {
 *       transport: bulkEmailTransport,
 *       selector: (msg) => msg.tags?.includes("newsletter"),
 *     },
 *     {
 *       transport: transactionalTransport,
 *       selector: (msg) => msg.priority === "high",
 *     },
 *     { transport: defaultTransport }, // Catches everything else
 *   ],
 * });
 * ```
 */
export declare class PoolTransport<TProviderId extends string = string>
  implements Transport<TProviderId | 'pool'>, AsyncDisposable
{
  readonly id = 'pool';
  /**
   * The resolved configuration used by this pool transport.
   */
  readonly config: ResolvedPoolConfig<TProviderId>;
  /**
   * Creates a new PoolTransport instance.
   *
   * @param config Configuration options for the pool transport.
   * @throws {Error} If the configuration is invalid.
   */
  constructor(config: PoolConfig<TProviderId>);
  /**
   * Sends a single email message using the pool strategy.
   *
   * The transport is selected based on the configured strategy. If the
   * selected transport fails, the pool will retry with other transports
   * up to the configured retry limit.
   *
   * @param message The email message to send.
   * @param options Optional transport options including abort signal.
   * @returns A promise that resolves to a receipt indicating success or failure.
   */
  send(message: Message, options?: TransportOptions): Promise<Receipt<TProviderId | 'pool'>>;
  /**
   * Sends multiple email messages using the pool strategy.
   *
   * Each message is sent individually using the `send` method, respecting
   * the configured strategy and retry logic.
   *
   * @param messages An iterable or async iterable of messages to send.
   * @param options Optional transport options including abort signal.
   * @returns An async iterable of receipts, one for each message.
   */
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<TProviderId | 'pool'>>;
  /**
   * Disposes of all underlying transports that support disposal.
   *
   * This method is called automatically when using the `await using` syntax.
   * It ensures proper cleanup of resources held by the underlying transports.
   * Each transport is disposed of once, whichever of them fails.
   * @throws {AggregateError} With the errors of the transports that failed.
   */
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Round-robin strategy that cycles through transports in order.
 *
 * This strategy maintains an internal counter and selects transports
 * in a circular fashion, ensuring even distribution of messages across
 * all enabled transports.
 */
export declare class RoundRobinStrategy<
  TProviderId extends string = string,
> implements Strategy<TProviderId> {
  /**
   * Selects the next transport in round-robin order.
   *
   * @param _message The message to send (unused in this strategy).
   * @param transports Available transports.
   * @param attemptedIndices Indices of transports that have already been
   *                         attempted.
   * @returns The selected transport or `undefined` if all transports have been
   *          attempted.
   */
  select(
    _message: Message,
    transports: readonly ResolvedTransportEntry<TProviderId>[],
    attemptedIndices: ReadonlySet<number>,
  ): TransportSelection<TProviderId> | undefined;
  /**
   * Resets the round-robin counter to start from the beginning.
   */
  reset(): void;
}

/**
 * Weighted strategy that distributes traffic based on configured weights.
 *
 * This strategy uses weighted random selection to distribute messages
 * across transports proportionally to their configured weights.
 * A transport with weight 2 will receive approximately twice as many
 * messages as a transport with weight 1.
 */
export declare class WeightedStrategy<
  TProviderId extends string = string,
> implements Strategy<TProviderId> {
  /**
   * @param options `random`, the source of the random choices.
   */
  constructor(options?: { readonly random?: () => number });
  /**
   * Selects a transport based on weighted random distribution.
   *
   * @param _message The message to send (unused in this strategy).
   * @param transports Available transports.
   * @param attemptedIndices Indices of transports that have already been
   *                         attempted.
   * @returns The selected transport or `undefined` if all transports have been
   *          attempted.
   */
  select(
    _message: Message,
    transports: readonly ResolvedTransportEntry<TProviderId>[],
    attemptedIndices: ReadonlySet<number>,
  ): TransportSelection<TProviderId> | undefined;
  /**
   * Resets the strategy (no-op for weighted strategy as it's stateless).
   */
  reset(): void;
}

/**
 * Priority strategy that selects transports based on priority values.
 *
 * This strategy always attempts to use the highest priority transport
 * first, falling back to lower priority transports only when higher
 * priority ones fail. Transports with the same priority are considered
 * equivalent and one is selected randomly.
 */
export declare class PriorityStrategy<
  TProviderId extends string = string,
> implements Strategy<TProviderId> {
  /**
   * @param options `random`, the source of the random choices.
   */
  constructor(options?: { readonly random?: () => number });
  /**
   * Selects the highest priority transport that hasn't been attempted.
   *
   * @param _message The message to send (unused in this strategy).
   * @param transports Available transports.
   * @param attemptedIndices Indices of transports that have already been
   *                         attempted.
   * @returns The selected transport or `undefined` if all transports have been
   *          attempted.
   */
  select(
    _message: Message,
    transports: readonly ResolvedTransportEntry<TProviderId>[],
    attemptedIndices: ReadonlySet<number>,
  ): TransportSelection<TProviderId> | undefined;
  /**
   * Resets the strategy (no-op for priority strategy as it's stateless).
   */
  reset(): void;
}

/**
 * Selector strategy that routes messages based on custom selector functions.
 *
 * This strategy evaluates each transport's selector function (if provided)
 * to determine if it should handle a specific message. Transports without
 * selectors are considered as catch-all fallbacks. Among matching transports,
 * one is selected randomly.
 */
export declare class SelectorStrategy<
  TProviderId extends string = string,
> implements Strategy<TProviderId> {
  /**
   * @param options `random`, the source of the random choices.
   */
  constructor(options?: { readonly random?: () => number });
  /**
   * Selects a transport based on selector function matching.
   *
   * @param message The message to send.
   * @param transports Available transports.
   * @param attemptedIndices Indices of transports that have already been
   *                         attempted.
   * @returns The selected transport or `undefined` if no transport matches.
   */
  select(
    message: Message,
    transports: readonly ResolvedTransportEntry<TProviderId>[],
    attemptedIndices: ReadonlySet<number>,
  ): TransportSelection<TProviderId> | undefined;
  /**
   * Resets the strategy (no-op for selector strategy as it's stateless).
   */
  reset(): void;
}
