// Types ported from unemail v0.7.0 (src/middleware)
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

/// <reference lib="esnext.disposable" />

import type {
  Message,
  RawMessage,
  RawTransport,
  Receipt,
  Transport,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

/**
 * What a store holds for a key: `pending` while its send is in flight,
 * `done` with the receipt of a send that went or may have gone.
 */
export interface IdempotencyRecord {
  readonly state: 'pending' | 'done';
  /** The fingerprint of the message sent under the key. */
  readonly fingerprint: string;
  /** The receipt of the send, when it is `done`. */
  readonly receipt?: Receipt;
}

/**
 * Where idempotency keys are kept.  A store shared by several processes, such
 * as one on Redis or MongoDB, must make `reserve` atomic: of two calls for a
 * free key, one reserves it and the other gets the record.
 */
export interface IdempotencyStore {
  /**
   * Reserves a key for `ttlMs`: `undefined` (or `null`) when it was free and
   * is now `pending`, or the record that holds it.
   */
  reserve(
    key: string,
    fingerprint: string,
    ttlMs: number,
  ): IdempotencyRecord | undefined | null | Promise<IdempotencyRecord | undefined | null>;
  /** Keeps a key `done` with the receipt of its send, for `ttlMs`. */
  complete(
    key: string,
    record: { readonly fingerprint: string; readonly receipt: Receipt },
    ttlMs: number,
  ): void | Promise<void>;
  /** Frees a key whose send failed and may be made again. */
  release(key: string): void | Promise<void>;
}

/**
 * The options of {@link IdempotencyTransport}.
 */
export interface IdempotencyConfig {
  /**
   * Where the keys are kept.  The default is an in-process store, which
   * deduplicates only within this process.
   */
  readonly store?: IdempotencyStore;
  /**
   * How long a key is kept, in milliseconds.
   * @default 86400000
   */
  readonly ttlMs?: number;
  /**
   * The key of a message; its `idempotencyKey` without it.  A message
   * without a key goes as it is.
   */
  readonly key?: (message: Message | RawMessage) => string | undefined;
  /**
   * The prefix of the keys in the store, so that the same key sent through
   * two transports is two sends.
   * @default the id of the wrapped transport
   */
  readonly namespace?: string;
}

/**
 * The options of {@link IdempotencyTransport}, with their defaults.
 */
export interface ResolvedIdempotencyConfig {
  readonly store: IdempotencyStore;
  readonly ttlMs: number;
  readonly key?: (message: Message | RawMessage) => string | undefined;
  readonly namespace: string;
}

/**
 * The options of {@link createMemoryIdempotencyStore}.
 */
export interface MemoryIdempotencyStoreOptions {
  /**
   * The most keys kept, the oldest dropped first.
   * @default 100000
   */
  readonly maxEntries?: number;
  /** The clock, in milliseconds. */
  readonly now?: () => number;
}

/**
 * Makes a store of idempotency keys in this process: shared by the transports
 * given it, not by other processes, and lost on a restart.
 *
 * @throws {TypeError} If an option is invalid.
 */
export declare function createMemoryIdempotencyStore(
  options?: MemoryIdempotencyStoreOptions,
): IdempotencyStore;

/**
 * A transport that sends a message with an idempotency key once.  The key is
 * reserved before the send; a later send under it answers with the receipt of
 * the first, or, while the first is in flight, with a receipt of unknown
 * delivery (code `idempotency.in_flight`); the same key for another message
 * is refused (`idempotency.key_reused`).  A send that failed frees its key, one
 * of unknown delivery keeps it; a store that fails fails the message it was
 * asked about alone (`idempotency.store_failed`, retryable).
 *
 * @example
 * ```js
 * const { IdempotencyTransport } = require('@alexify/mailer/idempotency');
 * const once = new IdempotencyTransport(transport, { store: redisStore });
 * await once.send(createMessage({ ...fields, idempotencyKey: `welcome:${userId}` }));
 * ```
 */
export declare class IdempotencyTransport<TProviderId extends string = string>
  implements RawTransport<TProviderId>, VerifiableTransport<TProviderId>, AsyncDisposable
{
  readonly id: TProviderId;
  /** The resolved options. */
  readonly config: ResolvedIdempotencyConfig;
  /**
   * @param transport The transport to guard.
   * @param config The options.
   * @throws {TypeError} If an option is invalid.
   */
  constructor(transport: Transport<TProviderId>, config?: IdempotencyConfig);
  /** Sends one message, unless its key was used before. */
  send(message: Message, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Sends a raw message, unless the key `key` gives it was used before.  A
   * wrapped transport without `sendRaw()` gives a failed receipt of the
   * category `configuration`.
   */
  sendRaw(message: RawMessage, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Sends messages through the `sendMany()` of the wrapped transport, one whose
   * key was used before, in the batch too, answered in place.
   */
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<TProviderId>>;
  /** Verifies the wrapped transport. */
  verify(options?: TransportOptions): Promise<void>;
  /** Disposes of the wrapped transport when it supports disposal. */
  [Symbol.asyncDispose](): Promise<void>;
}
