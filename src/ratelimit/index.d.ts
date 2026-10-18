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
 * The options of {@link RateLimitTransport}.
 */
/**
 * A store of token buckets that the processes of an application share, so
 * that N of them send no more than the one limit of the provider: on Redis,
 * a script that refills and takes in one step.
 */
export interface RateLimitStore {
  /**
   * Takes `cost` tokens of the bucket of `key`, refilled at `limit` tokens
   * every `intervalMs` up to `burst`, when it holds them: `{ taken: true }`;
   * or `{ taken: false, waitMs }`, the time until it would.
   */
  take(
    key: string,
    cost: number,
    bucket: { readonly limit: number; readonly intervalMs: number; readonly burst: number },
  ):
    | { readonly taken: boolean; readonly waitMs?: number }
    | Promise<{ readonly taken: boolean; readonly waitMs?: number }>;
}

export interface RateLimitConfig {
  /** The tokens a bucket gains every `intervalMs`: the sustained rate. */
  readonly limit: number;
  /**
   * The interval of `limit`, in milliseconds.
   * @default 1000
   */
  readonly intervalMs?: number;
  /**
   * The tokens a bucket holds, the most sent at once after a quiet spell.
   * @default limit
   */
  readonly burst?: number;
  /**
   * `wait` holds a message until its tokens come, first in first out; `reject`
   * answers at once with a retryable `rate-limit` receipt.
   * @default "wait"
   */
  readonly mode?: 'wait' | 'reject';
  /**
   * The longest a message may wait, counted from its arrival; one the queue
   * ahead of it would hold longer is answered at once, as in `reject` mode.
   * @default 30000
   */
  readonly maxWaitMs?: number;
  /**
   * The bucket of a message, such as its tenant; one bucket for all without
   * it.
   */
  readonly key?: (message: Message | RawMessage) => string;
  /**
   * The tokens a message takes, such as its number of recipients for SES;
   * 1 without it.  A cost over `burst` is refused.
   */
  readonly cost?: (message: Message | RawMessage) => number;
  /**
   * The most buckets kept: past it, the least used bucket with no waiter is
   * dropped, and its key starts full when it comes back.
   * @default 10000
   */
  readonly maxKeys?: number;
  /** The clock, in milliseconds. */
  readonly now?: () => number;
  /**
   * A pino-like logger: it hears a refused send at `info` (`ratelimit.limited`) and a send that
   * waits at `debug` (`ratelimit.waiting`), with `waitMs`.
   */
  readonly logger?: Logger;
  /**
   * The buckets the processes share, in place of the ones of this process:
   * a send waits, while `maxWaitMs` allows, for the time the store says, and
   * the store, not this process, keeps the order.
   */
  readonly store?: RateLimitStore;
}

/**
 * The options of {@link RateLimitTransport}, with their defaults.
 */
export interface ResolvedRateLimitConfig {
  readonly limit: number;
  readonly intervalMs: number;
  readonly burst: number;
  readonly mode: 'wait' | 'reject';
  readonly maxWaitMs: number;
  readonly key?: (message: Message | RawMessage) => string;
  readonly cost?: (message: Message | RawMessage) => number;
  readonly maxKeys: number;
  readonly now: () => number;
}

/**
 * A transport that sends through the one it wraps at most `limit` messages
 * every `intervalMs`, with bursts up to `burst`: a token bucket per `key`,
 * its waiters served first in, first out.  A message that would wait longer
 * than `maxWaitMs`, or any that must wait in `reject` mode, is answered at
 * once with a retryable `rate-limit` receipt (code `ratelimit.limited`) and
 * the wait in `retryAfterMilliseconds`; an abort of the caller takes a
 * waiting message out of the queue.
 *
 * @example
 * ```js
 * const { RateLimitTransport } = require('@alexify/mailer/ratelimit');
 * // SES at 14 messages a second, counted per recipient.
 * const throttled = new RateLimitTransport(ses, {
 *   limit: 14,
 *   cost: (message) =>
 *     message.recipients.length + message.ccRecipients.length + message.bccRecipients.length,
 * });
 * ```
 */
export declare class RateLimitTransport<TProviderId extends string = string>
  implements RawTransport<TProviderId>, VerifiableTransport<TProviderId>, AsyncDisposable
{
  readonly id: TProviderId;
  /** The resolved options. */
  readonly config: ResolvedRateLimitConfig;
  /**
   * @param transport The transport to throttle.
   * @param config The options.
   * @throws {TypeError} If an option is invalid.
   */
  constructor(transport: Transport<TProviderId>, config: RateLimitConfig);
  /** Sends one message once its bucket has its tokens. */
  send(message: Message, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Sends a raw message once its bucket has its tokens.  A wrapped transport
   * without `sendRaw()` gives a failed receipt of the category
   * `configuration`.
   */
  sendRaw(message: RawMessage, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Sends messages through the `sendMany()` of the wrapped transport, each
   * handed to it once its bucket has its tokens; one refused is answered in
   * place, the receipts in the order of the messages.
   */
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<TProviderId>>;
  /** Verifies the wrapped transport, without taking tokens. */
  verify(options?: TransportOptions): Promise<void>;
  /**
   * Stops the waits, each send waiting for tokens rejecting with an
   * `AbortError`, refuses the sends after it, and disposes of the wrapped
   * transport when it supports disposal.
   */
  [Symbol.asyncDispose](): Promise<void>;
}
