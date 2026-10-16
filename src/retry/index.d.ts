// Types ported from upyo v0.7.0 (packages/retry/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/// <reference lib="esnext.disposable" />

import type {
  IdOptions,
  Message,
  Receipt,
  ReceiptError,
  Transport,
  TransportOptions,
} from '../../index.js';

/**
 * Jitter mode for computed retry delays.
 */
export type JitterConfig = false | 'none' | 'full';
/**
 * Exponential backoff settings for retry delays.
 */
export interface BackoffConfig {
  /**
   * Delay before the first retry, in milliseconds.
   *
   * @default 1000
   */
  readonly baseDelayMilliseconds?: number;
  /**
   * Maximum computed delay, in milliseconds.  A `Retry-After` longer than it
   * is not retried sooner: the failure is returned with its delay.
   *
   * @default 30000
   */
  readonly maxDelayMilliseconds?: number;
  /**
   * Multiplier applied after each failed attempt.
   *
   * @default 2
   */
  readonly factor?: number;
}
/**
 * Context passed to custom retry wait functions.
 */
export interface DelayContext<TProviderId extends string = string> {
  /**
   * Attempt that just failed.
   */
  readonly attempt: number;
  /**
   * Attempt that will run after this delay.
   */
  readonly nextAttempt: number;
  /**
   * Maximum configured attempts.
   */
  readonly maxAttempts: number;
  /**
   * Delay to wait before retrying, in milliseconds.
   */
  readonly delayMilliseconds: number;
  /**
   * Failed receipt that caused the retry, when the transport returned one.
   */
  readonly receipt?: Receipt<TProviderId> & {
    readonly successful: false;
  };
  /**
   * Thrown error that caused the retry, when the transport rejected.
   */
  readonly error?: unknown;
  /**
   * Why the delay is being applied.
   */
  readonly reason: 'retry' | 'sendMany-throttle';
}
/**
 * Function used to wait between attempts or throttled sends.
 *
 * @param context Information about the delay being applied.
 * @param signal Abort signal that should cancel the wait.
 * @returns A promise that resolves when the delay is complete.
 * @throws {DOMException} If the wait is aborted.
 */
export type WaitFunction<TProviderId extends string = string> = (
  context: DelayContext<TProviderId>,
  signal?: AbortSignal,
) => Promise<void>;
/**
 * Failure passed to a custom retry classifier.
 */
export type RetryFailure<TProviderId extends string = string> =
  | {
      readonly kind: 'receipt';
      readonly receipt: Receipt<TProviderId> & {
        readonly successful: false;
      };
    }
  | {
      readonly kind: 'error';
      readonly error: unknown;
      readonly receiptError?: ReceiptError<TProviderId>;
    };
/**
 * Function that decides whether a failure should be retried.
 *
 * @param failure Failed receipt or thrown error metadata.
 * @returns Whether another attempt should be made.
 */
export type RetryClassifier<TProviderId extends string = string> = (
  failure: RetryFailure<TProviderId>,
) => boolean;
/**
 * Retry behavior for `sendMany()`.
 */
export interface SendManyRetryConfig {
  /**
   * Maximum number of messages to send at the same time.
   *
   * @default 1
   */
  readonly maxConcurrent?: number;
  /**
   * Minimum delay between launching message sends, in milliseconds.
   *
   * @default 0
   */
  readonly intervalMilliseconds?: number;
}
/**
 * Configuration for the retry transport decorator.
 */
export interface RetryConfig<TProviderId extends string = string> extends IdOptions {
  /**
   * Total number of send attempts, including the first one.
   *
   * @default 3
   */
  readonly maxAttempts?: number;
  /**
   * Exponential backoff settings.
   */
  readonly backoff?: BackoffConfig;
  /**
   * Jitter mode applied to computed backoff delays.
   *
   * `Retry-After` delays are not jittered.
   *
   * @default "full"
   */
  readonly jitter?: JitterConfig;
  /**
   * Random number source for jitter.
   *
   * @default Math.random
   */
  readonly random?: () => number;
  /**
   * Custom retry classifier.
   */
  readonly shouldRetry?: RetryClassifier<TProviderId>;
  /**
   * Custom wait function for tests or host-controlled scheduling.
   */
  readonly wait?: WaitFunction<TProviderId>;
  /**
   * Retry and throttling behavior for `sendMany()`.
   */
  readonly sendMany?: SendManyRetryConfig;
}
/**
 * Resolved retry configuration with defaults applied.
 */
interface ResolvedRetryConfig<TProviderId extends string = string> {
  readonly maxAttempts: number;
  readonly backoff: Required<BackoffConfig>;
  readonly jitter: JitterConfig;
  readonly random: () => number;
  readonly shouldRetry?: RetryClassifier<TProviderId>;
  readonly wait: WaitFunction<TProviderId>;
  readonly sendMany: Required<SendManyRetryConfig>;
}
/**
 * Creates a resolved retry configuration.
 *
 * @param config Retry configuration.
 * @returns The resolved configuration.
 * @throws {RangeError} If a numeric option is out of range.
 */

/**
 * Transport decorator that retries transient delivery failures.
 */
export declare class RetryTransport<TProviderId extends string = string>
  implements Transport<TProviderId>, AsyncDisposable
{
  readonly id: TProviderId;
  /**
   * Resolved retry configuration.
   */
  readonly config: ResolvedRetryConfig<TProviderId>;
  /**
   * Creates a retrying transport around another transport.
   *
   * @param transport The transport to wrap.
   * @param config Retry configuration.
   * @throws {RangeError} If retry configuration is invalid.
   */
  constructor(transport: Transport<TProviderId>, config?: RetryConfig<TProviderId>);
  /**
   * Sends one message, retrying retryable failures.
   *
   * @param message The message to send.
   * @param options Optional transport options.
   * @returns The final delivery receipt.
   * @throws {DOMException} If the operation is aborted.
   */
  send(message: Message, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Sends messages with per-message retry behavior.
   *
   * Receipts are yielded in the same order as input messages.
   *
   * @param messages Messages to send.
   * @param options Optional transport options.
   * @returns An async iterable of receipts.
   * @throws {DOMException} If the operation is aborted.
   */
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<TProviderId>>;
  /**
   * Disposes the wrapped transport when it supports disposal.
   *
   * @throws {unknown} If the wrapped transport's async or sync disposal hook
   *   throws or rejects.
   */
  [Symbol.asyncDispose](): Promise<void>;
}
/**
 * Creates a retrying transport around another transport.
 *
 * @param baseTransport The transport to wrap.
 * @param config Retry configuration.
 * @returns A retrying transport decorator.
 * @throws {RangeError} If retry configuration is invalid.
 */
export declare function createRetryTransport<TProviderId extends string = string>(
  baseTransport: Transport<TProviderId>,
  config?: RetryConfig<TProviderId>,
): RetryTransport<TProviderId>;
