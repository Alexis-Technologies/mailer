// Ported from upyo v0.7.0 (packages/logtape/src/logtape-transport.ts), adapted to
// a pino-like logger passed in instead of LogTape's getLogger(category).
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { inspect } = require('node:util');
const { redactAddresses } = require('../internal/redact-addresses.js');
const { resolveLoggerTransportOptions } = require('./config.js');
const { PendingQueue } = require('./pending-queue.js');

/**
 * Transport that records email delivery lifecycle events through a logger the
 * application passes in: any pino-like logger whose methods take the
 * properties first and the message second (`logger.info(properties, message)`).
 *
 * With no wrapped transport, this class acts as a log-only transport and
 * returns synthetic successful receipts.  When a transport is supplied, it
 * decorates that transport without changing its receipts or thrown errors.
 *
 * @typeParam TProviderId The provider id of the wrapped transport, or
 *                        `"logger"` in log-only mode.
 */
class LoggerTransport {
  /** Provider id used by receipts from this transport. */
  id;

  /** Fully resolved transport options. */
  config;

  logger;
  wrappedTransport;

  /**
   * Creates a logger transport.
   *
   * @param options The logger, and optional wrapped transport and logging
   *                configuration.
   * @throws {TypeError} If the logger is missing, or has no method for a
   *                     configured level.
   */
  constructor(options) {
    this.config = resolveLoggerTransportOptions(options ?? {});
    this.wrappedTransport = this.config.transport;
    this.id = this.wrappedTransport?.id ?? 'logger';
    this.logger = this.config.logger;
  }

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
  send(message, options) {
    return this.sendOne(message, options, 'send');
  }

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
  async *sendMany(messages, options) {
    options?.signal?.throwIfAborted();

    if (this.wrappedTransport == null) {
      for await (const message of messages) {
        yield await this.sendOne(message, options, 'sendMany');
      }
      return;
    }

    const pending = new PendingQueue();
    const batchStartedAt = performance.now();
    let consumedCount = 0;
    let completedCount = 0;
    const observedMessages = this.observeMessages(
      messages,
      pending,
      options,
      () => consumedCount++,
    );

    try {
      for await (const receipt of this.wrappedTransport.sendMany(observedMessages, options)) {
        const current = pending.dequeue();
        completedCount++;
        this.logReceipt(receipt, current, 'sendMany');
        yield receipt;
      }
    } catch (error) {
      this.logBatchThrownError(error, pending, batchStartedAt, consumedCount, completedCount);
      throw error;
    }
  }

  /**
   * Disposes the wrapped transport when it supports explicit resource
   * management.
   */
  async [Symbol.asyncDispose]() {
    const transport = this.wrappedTransport;
    if (transport == null) return;

    if (isAsyncDisposable(transport)) {
      await transport[Symbol.asyncDispose]();
      return;
    }

    if (isDisposable(transport)) {
      transport[Symbol.dispose]();
    }
  }

  async sendOne(message, options, operation) {
    options?.signal?.throwIfAborted();
    const startedAt = performance.now();
    this.logSending(message, operation);

    try {
      const receipt =
        this.wrappedTransport == null
          ? this.createSyntheticReceipt()
          : await this.wrappedTransport.send(message, options);
      this.logReceipt(receipt, { message, startedAt }, operation);
      return receipt;
    } catch (error) {
      this.logThrownError(error, message, operation, startedAt);
      throw error;
    }
  }
  async *observeMessages(messages, pending, options, onConsume) {
    for await (const message of messages) {
      options?.signal?.throwIfAborted();
      const startedAt = performance.now();
      this.logSending(message, 'sendMany');
      pending.enqueue({ message, startedAt });
      onConsume();
      yield message;
    }
  }

  createSyntheticReceipt() {
    return {
      successful: true,
      messageId: `logger-${crypto.randomUUID()}`,
      provider: this.id,
      attempts: 1,
      timestamp: new Date().toISOString(),
    };
  }

  logSending(message, operation) {
    this.log(this.config.levels.sending, this.getMessageText('Sending email.', message), {
      ...this.getMessageProperties(message),
      event: 'email.sending',
      operation,
      transportId: this.id,
    });
  }

  logReceipt(receipt, pendingMessage, operation) {
    const durationMilliseconds =
      pendingMessage == null ? undefined : performance.now() - pendingMessage.startedAt;
    const messageProperties =
      pendingMessage == null ? {} : this.getMessageProperties(pendingMessage.message);

    if (receipt.successful) {
      this.log(
        this.config.levels.sent,
        this.getMessageText('Email sent.', pendingMessage?.message),
        {
          ...messageProperties,
          event: 'email.sent',
          operation,
          transportId: this.id,
          durationMilliseconds,
          messageId: receipt.messageId,
          provider: receipt.provider ?? this.id,
          receipt,
        },
      );
      return;
    }

    const failure = this.config.recordMessage === false ? redactFailure(receipt) : receipt;
    this.log(
      this.config.levels.failed,
      this.getMessageText('Failed to send email.', pendingMessage?.message),
      {
        ...messageProperties,
        event: 'email.failed',
        operation,
        transportId: this.id,
        durationMilliseconds,
        errorMessages: failure.errorMessages,
        errors: failure.errors,
        retryable: failure.retryable,
        provider: failure.provider ?? this.id,
        attempts: failure.attempts,
        receipt: failure,
      },
    );
  }

  logThrownError(error, message, operation, startedAt, extraProperties = {}) {
    this.log(
      this.config.levels.failed,
      this.getMessageText(`Failed to send email: ${describe(error)}`, message),
      {
        ...(message == null ? {} : this.getMessageProperties(message)),
        ...extraProperties,
        event: 'email.failed',
        operation,
        transportId: this.id,
        durationMilliseconds: performance.now() - startedAt,
        // pino serializes an error under `err` only; under another key an
        // Error comes out as {}.
        err: error,
      },
    );
  }

  logBatchThrownError(error, pending, batchStartedAt, consumedCount, completedCount) {
    const batchProperties = {
      consumedCount,
      completedCount,
      pendingCount: pending.size,
    };
    if (pending.size < 1) {
      this.logThrownError(error, undefined, 'sendMany', batchStartedAt, batchProperties);
      return;
    }

    for (const pendingMessage of pending) {
      this.logThrownError(
        error,
        pendingMessage.message,
        'sendMany',
        pendingMessage.startedAt,
        batchProperties,
      );
    }
  }

  getMessageProperties(message) {
    return {
      recipientCount: message.recipients.length,
      ccRecipientCount: message.ccRecipients.length,
      bccRecipientCount: message.bccRecipients.length,
      attachmentCount: message.attachments.length,
      priority: message.priority,
      ...(this.config.recordMessage === false ? {} : { message }),
    };
  }

  // LogTape interpolated the {message.subject} and {message.content.*}
  // placeholders of a template; a pino-like logger does not, so the text is
  // built here.
  getMessageText(lifecycleMessage, message) {
    if (this.config.recordMessage !== 'inline' || message == null) {
      return lifecycleMessage;
    }

    const content =
      'text' in message.content && message.content.text !== undefined
        ? message.content.text
        : message.content.html;
    return `${lifecycleMessage}\n\nSubject: ${message.subject}\n\n${content}`;
  }

  // The properties first and the message second, as pino takes them.
  log(level, message, properties) {
    this.logger[level](properties, message);
  }
}

// Unless the message itself is logged, a failure is logged without the
// addresses its error text names, such as the recipient of an SMTP rejection,
// and without the provider's raw response.
const redactFailure = (receipt) => {
  const errorMessages = [];
  for (const text of receipt.errorMessages) errorMessages.push(redactAddresses(text));
  let errors = receipt.errors;
  if (errors != null) {
    errors = [];
    for (const error of receipt.errors) {
      errors.push({
        ...error,
        message: redactAddresses(error.message),
        providerDetails: undefined,
      });
    }
  }
  return { ...receipt, errorMessages, errors };
};

const isAsyncDisposable = (value) => {
  return Symbol.asyncDispose in value && typeof value[Symbol.asyncDispose] === 'function';
};

const isDisposable = (value) => {
  return Symbol.dispose in value && typeof value[Symbol.dispose] === 'function';
};

// What LogTape rendered for {error}: an Error as "TypeError: message", any
// other value inspected.
const describe = (value) =>
  value instanceof Error ? `${value.name}: ${value.message}` : inspect(value);

module.exports = { LoggerTransport };
