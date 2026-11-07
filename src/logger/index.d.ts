// Types ported from upyo v0.7.0 (packages/logtape/src), adapted to a pino-like
// logger passed in instead of LogTape.
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/// <reference lib="esnext.disposable" />

import type {
  AnyMessage,
  IdOptions,
  Logger,
  LoggerLevel,
  Message,
  RawMessage,
  Receipt,
  Transport,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

// The logger types are those of the root entry, shared by every transport;
// LoggerTransport writes with `debug`, `info` and `error` by default, and
// `warn` when it wraps a transport.
export type { Logger, LoggerLevel, LogMethod } from '../../index.js';

/**
 * Log levels used for the delivery lifecycle events of a message.
 */
export interface LoggerTransportLevels {
  /**
   * Level used before a message is handed to the transport.
   *
   * @default "debug"
   */
  readonly sending?: LoggerLevel;
  /**
   * Level used after a message is sent successfully.
   *
   * @default "info"
   */
  readonly sent?: LoggerLevel;
  /**
   * Level used when a transport returns a failed receipt or throws.
   *
   * @default "error"
   */
  readonly failed?: LoggerLevel;
  /**
   * Level used when the wrapped transport, or a `./retry` inside it, is about
   * to retry, as `onRetry` of `TransportOptions` tells.
   *
   * @default "warn"
   */
  readonly retrying?: LoggerLevel;
}

/**
 * Options for {@link LoggerTransport}.
 *
 * @typeParam TProviderId The provider id of the wrapped transport.
 * @typeParam TMessage The messages of the wrapped transport, email by default.
 */
export interface LoggerTransportOptions<
  TProviderId extends string = 'logger',
  TMessage extends AnyMessage = Message,
> extends IdOptions {
  /**
   * The logger to write to. It must have a method for each configured level;
   * the transport checks that when it is made.
   */
  readonly logger: Logger;
  /**
   * Transport that performs the actual delivery.
   *
   * When omitted, the logger transport only logs the delivery and returns a
   * synthetic successful receipt.
   */
  readonly transport?: Transport<TProviderId, TMessage>;
  /**
   * How to include the complete message in logs.
   *
   * `"properties"` adds the message to the structured properties while
   * keeping the lifecycle message on one line.  `"inline"` also renders the
   * subject and body of an email beneath the lifecycle message, or the text
   * of a message of a channel.  Plain text is preferred when it is defined;
   * otherwise, the HTML body is rendered.
   *
   * Messages may contain sensitive or large values, including email bodies,
   * headers, and attachment data.  Without this option, no recipient is
   * logged: neither the addresses of email nor the `to` of a message of a
   * channel, which the text of a failure is redacted of.
   *
   * @default undefined
   */
  readonly recordMessage?: 'properties' | 'inline';
  /**
   * Levels used for delivery lifecycle events.
   */
  readonly levels?: LoggerTransportLevels;
}

/**
 * Fully resolved options used by {@link LoggerTransport}.
 *
 * @typeParam TProviderId The provider id of the wrapped transport.
 */
export interface ResolvedLoggerTransportOptions<
  TProviderId extends string = 'logger',
  TMessage extends AnyMessage = Message,
> {
  /** The logger written to. */
  readonly logger: Logger;
  /** Transport that performs the actual delivery, if configured. */
  readonly transport?: Transport<TProviderId, TMessage>;
  /** Resolved complete-message recording mode, or `false` when disabled. */
  readonly recordMessage: 'properties' | 'inline' | false;
  /** Resolved delivery lifecycle log levels. */
  readonly levels: Required<LoggerTransportLevels>;
}

type LoggerTransportConstructorArguments<
  TProviderId extends string,
  TMessage extends AnyMessage,
> = [TProviderId] extends ['logger']
  ? [options: LoggerTransportOptions<TProviderId, TMessage>]
  : [
      options: LoggerTransportOptions<TProviderId, TMessage> & {
        readonly transport: Transport<TProviderId, TMessage>;
      },
    ];

/**
 * Transport that records the delivery lifecycle of messages, of email or of a
 * channel, through a logger the application passes in: any pino-like logger
 * whose methods take the properties first and the message second
 * (`logger.info(properties, message)`).  The events are `message.sending`,
 * `message.sent`, `message.retrying` and `message.failed`, each with the
 * `channel` of its message (`email` for one of email or raw MIME); a thrown
 * error is logged under `err`, the key pino serializes.  A retry is logged
 * with its attempt, its wait and the text of its error, without the
 * addresses and phone numbers in it unless the message is recorded.
 *
 * A message of a channel is logged with `recipientCount` (1), `mediaCount`,
 * `buttonCount`, `hasTemplate`, `hasPayload` and `priority`, and its `to`
 * only within the message, with `recordMessage`.
 *
 * With no wrapped transport, this class acts as a log-only transport and
 * returns synthetic successful receipts.  When a transport is supplied, it
 * decorates that transport without changing its receipts or thrown errors.
 *
 * @typeParam TProviderId The provider id of the wrapped transport, or
 *                        `"logger"` in log-only mode.
 */
export declare class LoggerTransport<
  TProviderId extends string = 'logger',
  TMessage extends AnyMessage = Message,
>
  implements VerifiableTransport<TProviderId, TMessage>, AsyncDisposable
{
  /** Provider id used by receipts from this transport. */
  readonly id: TProviderId;
  /** Fully resolved transport options. */
  readonly config: ResolvedLoggerTransportOptions<TProviderId, TMessage>;
  /**
   * Creates a logger transport.
   *
   * @param options The logger, and optional wrapped transport and logging
   *                configuration.
   * @throws {TypeError} If the logger is missing, or has no method for a
   *                     configured level.
   */
  constructor(...[options]: LoggerTransportConstructorArguments<TProviderId, TMessage>);
  /**
   * Sends one message while recording its delivery lifecycle.
   *
   * @param message The message to send.
   * @param options Optional transport options, including cancellation.
   * @returns The wrapped transport receipt, or a synthetic successful receipt
   *          in log-only mode.
   * @throws {DOMException} If the operation is aborted.
   * @throws {Error} If the wrapped transport throws an error.
   */
  send(message: TMessage, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Sends serialized MIME through the wrapped transport, its lifecycle logged with the envelope for the message.  A wrapped
   * transport without `sendRaw()` gives a failed receipt of the category
   * `configuration`.
   */
  sendRaw(message: RawMessage, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Verifies the wrapped transport; it has nothing to check when there is none or it cannot verify.
   */
  verify(options?: TransportOptions): Promise<void>;
  /**
   * Sends multiple messages while recording each delivery lifecycle.
   *
   * A wrapped transport's `sendMany()` implementation is used directly so
   * provider-specific batching and streaming behavior are preserved.
   * Completion logs are emitted as receipts are consumed.  Stopping iteration
   * early closes the wrapped iterator without draining it, preserving its
   * cancellation behavior.
   *
   * @param messages The messages to send.
   * @param options Optional transport options, including cancellation.
   * @returns An async iterable of unmodified delivery receipts.
   * @throws {DOMException} If the operation is aborted.
   * @throws {Error} If the wrapped transport throws an error.
   */
  sendMany(
    messages: Iterable<TMessage> | AsyncIterable<TMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<TProviderId>>;
  /**
   * Disposes the wrapped transport when it supports explicit resource
   * management.
   */
  [Symbol.asyncDispose](): Promise<void>;
}
