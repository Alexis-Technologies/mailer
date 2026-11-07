// Types ported from sently v1.2.2 (src)
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors

/// <reference lib="esnext.disposable" />

import type {
  AnyMessage,
  Message,
  RawMessage,
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
  /** The caller's signal, for a hook that waits on something to heed. */
  readonly signal?: AbortSignal;
}

/**
 * The hooks of {@link HooksTransport}, for the messages `TMessage` (email by
 * default).  A hook may be async; it is awaited.
 */
export interface Hooks<TMessage extends AnyMessage = Message> {
  /**
   * Before a message is sent: it may return a message to send in its place,
   * which is checked again as `createMessage` or `createChannelMessage`
   * checks one; when it throws, or returns one they refuse, the message is
   * not sent and its receipt is `rejected` (code `hooks.refused`), not
   * retryable.
   */
  readonly beforeSend?: (
    message: TMessage,
    context: HookContext,
  ) => TMessage | void | Promise<TMessage | void>;
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
    message: TMessage | RawMessage,
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
    message: TMessage | RawMessage,
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
 * each other's.  It takes the messages of the transport it wraps, of email
 * or of a channel, and sends raw MIME through one that does.
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
export declare class HooksTransport<
  TProviderId extends string = string,
  TMessage extends AnyMessage = Message,
>
  implements VerifiableTransport<TProviderId, TMessage>, AsyncDisposable
{
  readonly id: TProviderId;
  /** The hooks, checked. */
  readonly config: Hooks<TMessage> & { readonly now: () => number };
  /**
   * @param transport The transport to wrap.
   * @param hooks The hooks.
   * @throws {TypeError} If a hook is not a function.
   */
  constructor(transport: Transport<TProviderId, TMessage>, hooks?: Hooks<TMessage>);
  /** Sends one message between its hooks. */
  send(message: TMessage, options?: TransportOptions): Promise<Receipt<TProviderId>>;
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
    messages: Iterable<TMessage> | AsyncIterable<TMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<TProviderId>>;
  /** Verifies the wrapped transport. */
  verify(options?: TransportOptions): Promise<void>;
  /** Disposes of the wrapped transport when it supports disposal. */
  [Symbol.asyncDispose](): Promise<void>;
}
