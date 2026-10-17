// Types ported from unemail v0.7.0 (src/drivers)
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
 * What became of the copy of a message sent to a mirror: its receipt, the
 * error its send threw, or why it was skipped.
 */
export interface MirrorOutcome {
  /** The id of the mirror. */
  readonly mirror: string;
  /** The message mirrored. */
  readonly message: Message | RawMessage;
  readonly receipt?: Receipt;
  readonly error?: unknown;
  /** Why the copy was not sent. */
  readonly skipped?: string;
}

/**
 * The options of {@link TeeTransport}.
 */
export interface TeeConfig {
  /** The transports each message is mirrored to. */
  readonly mirrors: readonly Transport[];
  /**
   * The time a mirror's send may take, in milliseconds.
   * @default 10000
   */
  readonly timeout?: number;
  /**
   * Waits for the mirrors before returning the primary's receipt, as a
   * runtime that freezes after the response needs; they follow the caller's
   * signal then.  By default their sends go on alone.
   * @default false
   */
  readonly awaitMirrors?: boolean;
  /**
   * The most mirrored sends in flight while not awaited; a copy over it is
   * skipped.
   * @default 100
   */
  readonly maxPending?: number;
  /**
   * Hears every outcome of a mirror.  Without it, a failure or a skipped copy
   * becomes a process warning (`MAILER_TEE_MIRROR_FAILED`); one that throws
   * becomes one too (`MAILER_TEE_LISTENER_FAILED`).
   */
  readonly onMirror?: (outcome: MirrorOutcome) => void;
}

/**
 * The options of {@link TeeTransport}, with their defaults.
 */
export interface ResolvedTeeConfig {
  readonly mirrors: readonly Transport[];
  readonly timeout: number;
  readonly awaitMirrors: boolean;
  readonly maxPending: number;
  readonly onMirror?: (outcome: MirrorOutcome) => void;
}

/**
 * A transport that sends each message through a primary transport and
 * mirrors it to others, to shadow a new provider or copy mail into a local
 * catcher.  The primary's receipt is the one returned, whatever the mirrors
 * do: each has a timeout of its own and, by default, its send is not awaited.
 *
 * @example
 * ```js
 * const { TeeTransport } = require('@alexify/mailer/tee');
 * const shadowed = new TeeTransport(ses, {
 *   mirrors: [postmark],
 *   onMirror: (outcome) => metrics.record(outcome),
 * });
 * ```
 */
export declare class TeeTransport<TProviderId extends string = string>
  implements RawTransport<TProviderId>, VerifiableTransport<TProviderId>, AsyncDisposable
{
  readonly id: TProviderId;
  /** The resolved options. */
  readonly config: ResolvedTeeConfig;
  /**
   * @param primary The transport whose receipt is returned.
   * @param config The options.
   * @throws {TypeError} If an option is invalid.
   */
  constructor(primary: Transport<TProviderId>, config: TeeConfig);
  /** Sends a message through the primary and mirrors it. */
  send(message: Message, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Sends a raw message through the primary, mirrored to the mirrors that send
   * raw messages.  A primary without `sendRaw()` gives a failed receipt of the
   * category `configuration`.
   */
  sendRaw(message: RawMessage, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Sends messages through the `sendMany()` of the primary, each mirrored as it
   * is handed to it.
   */
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<TProviderId>>;
  /** Verifies the primary; the mirrors are not checked. */
  verify(options?: TransportOptions): Promise<void>;
  /**
   * Disposes of the primary and the mirrors, each once, whatever fails; the
   * failures reject together as an `AggregateError`.
   */
  [Symbol.asyncDispose](): Promise<void>;
}
