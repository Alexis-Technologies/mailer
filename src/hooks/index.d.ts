// Types ported from sently v1.2.2 (src)
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors

/// <reference lib="esnext.disposable" />

import type {
  Message,
  RawMessage,
  RawTransport,
  Receipt,
  RetryEvent,
  Transport,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

/**
 * The context of one send, made anew for each.
 */
export interface HookContext {
  /** The id of the wrapped transport. */
  readonly transportId: string;
  /** The method of the send. */
  readonly operation: 'send' | 'sendMany' | 'sendRaw';
  /** When the send began, by the clock `now`, in milliseconds. */
  readonly startedAt: number;
}

/**
 * The hooks of {@link HooksTransport}.  A hook may be async; it is awaited.
 */
export interface Hooks {
  /**
   * Before a message is sent: it may return a message to send in its place;
   * when it throws, the message is not sent and its receipt is `rejected`
   * (code `hooks.refused`), not retryable.
   */
  readonly beforeSend?: (
    message: Message,
    context: HookContext,
  ) => Message | void | Promise<Message | void>;
  /** Before a raw message is sent, as `beforeSend`. */
  readonly beforeSendRaw?: (
    message: RawMessage,
    context: HookContext,
  ) => RawMessage | void | Promise<RawMessage | void>;
  /**
   * After a send, with its receipt, successful or not; one that throws
   * becomes a process warning (`MAILER_HOOK_FAILED`) and the receipt stands.
   */
  readonly afterSend?: (
    receipt: Receipt,
    message: Message | RawMessage,
    context: HookContext,
  ) => void | Promise<void>;
  /**
   * Before a retry of the wrapped transport, or of a `./retry` within it, with
   * the context of its send (that of the batch for `sendMany()`).
   */
  readonly onRetry?: (event: RetryEvent, context: HookContext) => void;
  /**
   * When the wrapped transport throws, before the error goes on; and, with an
   * `AbortError`, for a message of a batch the caller stopped reading before
   * its answer, which a transport reading ahead may have sent.
   */
  readonly onError?: (
    error: unknown,
    message: Message | RawMessage,
    context: HookContext,
  ) => void | Promise<void>;
  /** The clock of `startedAt`, in milliseconds. */
  readonly now?: () => number;
}

/**
 * A transport that calls the hooks of the application around each send of
 * the one it wraps: `beforeSend` may replace or refuse a message, `afterSend`
 * hears every receipt, `onRetry` every retry and `onError` every thrown
 * error.  The context is that of each send, so concurrent sends never hear
 * each other's.
 *
 * @example
 * ```js
 * const { HooksTransport } = require('@alexify/mailer/hooks');
 * const hooked = new HooksTransport(transport, {
 *   beforeSend: async (message) => {
 *     if (await suppressed(message.recipients)) throw new Error('suppressed');
 *   },
 *   afterSend: (receipt, message, context) => audit(receipt, context),
 * });
 * ```
 */
export declare class HooksTransport<TProviderId extends string = string>
  implements RawTransport<TProviderId>, VerifiableTransport<TProviderId>, AsyncDisposable
{
  readonly id: TProviderId;
  /** The hooks, checked. */
  readonly config: Hooks & { readonly now: () => number };
  /**
   * @param transport The transport to wrap.
   * @param hooks The hooks.
   * @throws {TypeError} If a hook is not a function.
   */
  constructor(transport: Transport<TProviderId>, hooks?: Hooks);
  /** Sends one message between its hooks. */
  send(message: Message, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Sends a raw message between `beforeSendRaw` and `afterSend`.  A wrapped
   * transport without `sendRaw()` gives a failed receipt of the category
   * `configuration`.
   */
  sendRaw(message: RawMessage, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Sends messages through the `sendMany()` of the wrapped transport, each
   * between its hooks; one `beforeSend` refuses is answered in place.
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
