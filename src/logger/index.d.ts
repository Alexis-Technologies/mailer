// Types ported from upyo v0.7.0 (packages/logtape/src), adapted to a pino-like
// logger passed in instead of LogTape.
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/// <reference lib="esnext.disposable" />

import type { IdOptions, Message, Receipt, Transport, TransportOptions } from '../../index.js';

/**
 * A log level, by pino's names (LogTape's `warning` is `warn`).
 */
export type LoggerLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * A log method that takes the structured properties first and the message
 * second, as pino's do.
 */
export type LogMethod = (properties: object, message: string) => unknown;

/**
 * The logger the transport writes to: a pino logger, a child of one
 * (`logger.child({ component: 'mail' })`), or anything with the methods of the
 * levels in use. `debug`, `info` and `error` are the default levels, and `warn`
 * when a transport is wrapped.
 */
export interface Logger {
  readonly trace?: LogMethod;
  readonly debug?: LogMethod;
  readonly info?: LogMethod;
  readonly warn?: LogMethod;
  readonly error?: LogMethod;
  readonly fatal?: LogMethod;
}

/**
 * Log levels used for email delivery lifecycle events.
 */
export interface LoggerTransportLevels {
  /**
   * Level used before an email is handed to the transport.
   *
   * @default "debug"
   */
  readonly sending?: LoggerLevel;
  /**
   * Level used after an email is sent successfully.
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
 */
export interface LoggerTransportOptions<TProviderId extends string = 'logger'> extends IdOptions {
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
  readonly transport?: Transport<TProviderId>;
  /**
   * How to include the complete email message in logs.
   *
   * `"properties"` adds the message to the structured properties while
   * keeping the lifecycle message on one line.  `"inline"` also renders the
   * subject and body beneath the lifecycle message.  Plain text is preferred
   * when it is defined; otherwise, the HTML body is rendered.
   *
   * Messages may contain sensitive or large values, including email bodies,
   * headers, and attachment data.
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
export interface ResolvedLoggerTransportOptions<TProviderId extends string = 'logger'> {
  /** The logger written to. */
  readonly logger: Logger;
  /** Transport that performs the actual delivery, if configured. */
  readonly transport?: Transport<TProviderId>;
  /** Resolved complete-message recording mode, or `false` when disabled. */
  readonly recordMessage: 'properties' | 'inline' | false;
  /** Resolved delivery lifecycle log levels. */
  readonly levels: Required<LoggerTransportLevels>;
}

type LoggerTransportConstructorArguments<TProviderId extends string> = [TProviderId] extends [
  'logger',
]
  ? [options: LoggerTransportOptions<TProviderId>]
  : [
      options: LoggerTransportOptions<TProviderId> & {
        readonly transport: Transport<TProviderId>;
      },
    ];

/**
 * Transport that records email delivery lifecycle events through a logger the
 * application passes in: any pino-like logger whose methods take the
 * properties first and the message second (`logger.info(properties, message)`).
 * The events are `email.sending`, `email.sent`, `email.retrying` and
 * `email.failed`; a thrown error is logged under `err`, the key pino
 * serializes.  A retry is logged with its attempt, its wait and the text of its
 * error, without the addresses in it unless the message is recorded.
 *
 * With no wrapped transport, this class acts as a log-only transport and
 * returns synthetic successful receipts.  When a transport is supplied, it
 * decorates that transport without changing its receipts or thrown errors.
 *
 * @typeParam TProviderId The provider id of the wrapped transport, or
 *                        `"logger"` in log-only mode.
 */
export declare class LoggerTransport<TProviderId extends string = 'logger'>
  implements Transport<TProviderId>, AsyncDisposable
{
  /** Provider id used by receipts from this transport. */
  readonly id: TProviderId;
  /** Fully resolved transport options. */
  readonly config: ResolvedLoggerTransportOptions<TProviderId>;
  /**
   * Creates a logger transport.
   *
   * @param options The logger, and optional wrapped transport and logging
   *                configuration.
   * @throws {TypeError} If the logger is missing, or has no method for a
   *                     configured level.
   */
  constructor(...[options]: LoggerTransportConstructorArguments<TProviderId>);
  /**
   * Sends one email while recording its delivery lifecycle.
   *
   * @param message The email message to send.
   * @param options Optional transport options, including cancellation.
   * @returns The wrapped transport receipt, or a synthetic successful receipt
   *          in log-only mode.
   * @throws {DOMException} If the operation is aborted.
   * @throws {Error} If the wrapped transport throws an error.
   */
  send(message: Message, options?: TransportOptions): Promise<Receipt<TProviderId>>;
  /**
   * Sends multiple emails while recording each delivery lifecycle.
   *
   * A wrapped transport's `sendMany()` implementation is used directly so
   * provider-specific batching and streaming behavior are preserved.
   * Completion logs are emitted as receipts are consumed.  Stopping iteration
   * early closes the wrapped iterator without draining it, preserving its
   * cancellation behavior.
   *
   * @param messages Email messages to send.
   * @param options Optional transport options, including cancellation.
   * @returns An async iterable of unmodified delivery receipts.
   * @throws {DOMException} If the operation is aborted.
   * @throws {Error} If the wrapped transport throws an error.
   */
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<TProviderId>>;
  /**
   * Disposes the wrapped transport when it supports explicit resource
   * management.
   */
  [Symbol.asyncDispose](): Promise<void>;
}
