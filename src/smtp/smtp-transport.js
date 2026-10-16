// Ported from upyo v0.7.0 (packages/smtp/src/smtp-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { prepareRawSmtpMessage, Smtp8BitMimeUnsupportedError } = require('./raw-message.js');
const { classifyReceiptError, createFailedReceipt } = require('../core/receipt.js');
const { createRawMessagePlan, RawMessageValidationError } = require('../core/raw-message.js');
const {
  resolveSmtpDsn,
  SmtpDsnUnsupportedError,
  SmtpDsnValidationError,
} = require('./delivery-status.js');
const {
  SmtpAuthResponseError,
  SmtpConnection,
  SmtpMessageSizeError,
  SmtpResponseError,
  SmtpUtf8UnsupportedError,
} = require('./smtp-connection.js');
const { resolveSmtpEnvelope, SmtpEnvelopeValidationError } = require('./envelope.js');
const { OAuth2TokenManager } = require('./oauth2.js');
const { prepareMessage } = require('./message-converter.js');
const { SmtpAttachmentReplayError } = require('./message-stream.js');
const { SmtpDeliveryUnknownError } = require('./data-stream.js');
const { checkDkimConfig } = require('../mime/dkim/types.js');
const { checkDkimKeys } = require('../mime/dkim/sign.js');
const { parseEnhancedSmtpStatusCode } = require('./smtp-status-code.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');

/**
 * SMTP transport implementation for sending emails via SMTP protocol.
 *
 * This transport provides efficient email delivery with connection pooling,
 * support for authentication, TLS/SSL encryption, and batch sending capabilities.
 *
 * @example
 * ```typescript
 * import { SmtpTransport } from '@alexify/mailer/smtp';
 *
 * // Automatic resource cleanup with using statement
 * await using transport = new SmtpTransport({
 *   host: 'smtp.gmail.com',
 *   port: 465,
 *   secure: true, // Use TLS from start
 *   auth: {
 *     user: 'user@gmail.com',
 *     pass: 'app-password'
 *   }
 * });
 *
 * const receipt = await transport.send(message);
 * // Connections are automatically closed here
 *
 * // Or manual management
 * const transport2 = new SmtpTransport(config);
 * try {
 *   await transport2.send(message);
 * } finally {
 *   await transport2.closeAllConnections();
 * }
 * ```
 */
class SmtpTransport {
  id = 'smtp';

  /**
   * The SMTP configuration used by this transport.
   */
  config;

  /**
   * The maximum number of SMTP connections this transport may have open at
   * once.  The limit covers connections that are being established,
   * connections that are currently sending, and idle connections retained for
   * reuse, so it holds whether or not pooling is enabled.  A caller that needs
   * a connection while the limit is reached waits until one becomes available.
   * `Infinity` leaves the number of connections unbounded.
   */
  poolSize;

  /**
   * Idle connections retained for reuse.  Every connection in here also counts
   * towards {@link openConnectionCount}, so the pool can never grow past
   * {@link poolSize}.
   */
  connectionPool = [];

  /**
   * The number of connections this transport currently owns: connections being
   * established, connections checked out by a caller, and idle connections in
   * {@link connectionPool}.  Never exceeds {@link poolSize}.
   */
  openConnectionCount = 0;

  /**
   * Callers waiting for a connection to become available, in arrival order.
   */
  capacityWaiters = [];

  /** The current shutdown barrier; new callers wait until it completes. */
  closing;
  pendingAcquisitions = 0;
  onDrained;

  /**
   * A token manager shared across all pooled connections, present only when the
   * configured authentication uses OAuth 2.0.  Sharing it ensures the
   * refresh-token exchange happens at most once per token lifetime instead of
   * once per connection.
   */
  tokenManager;

  /**
   * Creates a new SMTP transport instance.
   *
   * @param config SMTP configuration including server details, authentication,
   *               and options.
   * @throws {RangeError} If `config.poolSize` is neither a positive integer nor
   *                        `Infinity`.
   * @throws {TypeError} If the DKIM configuration is invalid, or a PEM key of
   *                     it cannot be read (unless it sends unsigned).
   */
  constructor(config) {
    checkDkimConfig(config.dkim);
    checkDkimKeys(config.dkim);
    this.config = config;
    const poolSize = config.poolSize ?? 5;
    if (
      Number.isNaN(poolSize) ||
      poolSize < 1 ||
      (Number.isFinite(poolSize) && !Number.isInteger(poolSize))
    ) {
      throw new RangeError(`poolSize must be a positive integer or Infinity: ${poolSize}`);
    }
    this.poolSize = poolSize;
    const auth = config.auth;
    this.tokenManager =
      auth != null && ('accessToken' in auth || 'refreshToken' in auth)
        ? new OAuth2TokenManager(auth, config.fetch)
        : undefined;
  }

  /**
   * Leaves the credentials of the configuration out of `JSON.stringify()`.
   *
   * @returns A plain copy of the transport with its credentials redacted.
   */
  toJSON() {
    return redactSecrets(this);
  }

  /**
   * Leaves the credentials of the configuration out of `util.inspect()`, and
   * so out of `console.log()` and of loggers that inspect what they log.
   */
  [INSPECT](_depth, options, inspect) {
    return inspectRedacted(this, options, inspect);
  }

  /**
   * Checks a fresh SMTP connection, TLS policy, and configured authentication
   * without sending mail. Uses the shared connection limit and closes the
   * verification connection afterward, even when pooling is enabled.
   * Success does not guarantee acceptance of a sender, recipient, or message.
   * @param options Optional cancellation signal, including while waiting for capacity.
   * @returns A promise that resolves after successful verification and cleanup.
   * @throws {SmtpResponseError} If greeting, EHLO/HELO, or STARTTLS is rejected.
   * @throws {SmtpAuthError} If authentication fails.
   * @throws {Error} If a connection, TLS, or timeout error occurs.
   * @throws The caller's abort reason if cancelled.
   */
  async verify(options) {
    const signal = options?.signal;
    signal?.throwIfAborted();
    let connection;
    try {
      connection = await this.getConnection(signal, true);
      signal?.throwIfAborted();
    } catch (error) {
      signal?.throwIfAborted();
      throw error;
    } finally {
      if (connection != null) await this.discardConnection(connection, signal);
    }
    signal?.throwIfAborted();
  }

  /**
   * Sends a single email message via SMTP.
   *
   * This method converts the message to SMTP format, establishes a connection
   * to the SMTP server, sends the message, and returns a receipt with the result.
   *
   * @example
   * ```typescript
   * const receipt = await transport.send({
   *   sender: { address: 'from@example.com' },
   *   recipients: [{ address: 'to@example.com' }],
   *   subject: 'Hello',
   *   content: { text: 'Hello World!' }
   * });
   *
   * if (receipt.successful) {
   *   console.log('Message sent with ID:', receipt.messageId);
   * }
   * ```
   *
   * @param message The email message to send.
   * @param options Optional SMTP envelope, delivery status, and cancellation
   *                settings.
   * @returns A promise that resolves to a receipt indicating success or
   *          failure.
   * @throws {DOMException} If the operation is aborted through
   *                        `options.signal`.
   */
  async send(message, options) {
    options?.signal?.throwIfAborted();

    let connection;

    try {
      const envelope = resolveEnvelopeOption(message, options?.envelope, 0);
      const dsn = resolveSmtpDsn(envelope, options?.dsn);
      // Composed before a connection is taken: a message that cannot be
      // composed costs no connection, and fails no connection either.
      const smtpMessage = prepareMessage(message, this.config.dkim, dsn, envelope, this.config);

      // Establishing the connection—including authentication, e.g. acquiring an
      // OAuth 2.0 access token—is part of delivery, so setup failures are
      // reported as a failed receipt rather than thrown.  (Cancellation via the
      // abort signal still rejects: an already-aborted signal is caught by the
      // guard above, before this method does any work.)
      connection = await this.getConnection(options?.signal);

      options?.signal?.throwIfAborted();

      const result = await connection.sendMessage(smtpMessage, options?.signal);

      await this.returnConnection(connection);
      // Cleared so the catch below cannot hand the same connection back twice.
      connection = undefined;

      return {
        successful: true,
        messageId: result.messageId,
        provider: 'smtp',
        rejectedRecipients: result.rejectedRecipients,
      };
    } catch (error) {
      if (connection != null) {
        if (connection.usable && isReusableLocalFailure(error)) {
          await this.returnConnection(connection);
        } else {
          await this.discardConnection(connection);
        }
      }

      // Cancellation rejects rather than producing a receipt.
      options?.signal?.throwIfAborted();

      return createSmtpFailure(error instanceof Error ? error.message : String(error), error);
    }
  }

  /**
   * Delivers serialized MIME unchanged, apart from SMTP dot-stuffing.
   * Configured DKIM signing and message composition are bypassed.
   * @param message Original MIME bytes and explicit delivery envelope.
   * @param options Optional DSN and cancellation settings.
   * @returns An SMTP receipt, including any rejected recipients.
   * @throws {Error} If cancellation is requested.
   */
  async sendRaw(message, options) {
    if (message?.content instanceof Promise) message.content.catch(() => {});
    options?.signal?.throwIfAborted();
    let connection;
    try {
      const plan = createRawMessagePlan(message);
      if (options?.envelope !== undefined) {
        throw new SmtpEnvelopeValidationError('Raw message envelopes cannot be overridden.');
      }
      const dsn = resolveSmtpDsn(plan.envelope, options?.dsn);
      connection = await this.getConnection(options?.signal);
      const result = await connection.sendMessage(
        prepareRawSmtpMessage(plan, dsn),
        options?.signal,
      );
      await this.returnConnection(connection);
      connection = undefined;
      return {
        successful: true,
        provider: 'smtp',
        messageId: result.messageId,
        rejectedRecipients: result.rejectedRecipients,
      };
    } catch (error) {
      if (connection != null) {
        if (connection.usable && isReusableLocalFailure(error)) {
          await this.returnConnection(connection);
        } else {
          await this.discardConnection(connection);
        }
      }
      options?.signal?.throwIfAborted();
      return createSmtpFailure(error instanceof Error ? error.message : String(error), error);
    }
  }

  /**
   * Sends multiple email messages efficiently using a single SMTP connection.
   *
   * This method is optimized for bulk email sending by reusing a single SMTP
   * connection for all messages, which significantly improves performance
   * compared to sending each message individually.
   *
   * @example
   * ```typescript
   * const messages = [
   *   { subject: 'Message 1', recipients: [{ address: 'user1@example.com' }], ... },
   *   { subject: 'Message 2', recipients: [{ address: 'user2@example.com' }], ... }
   * ];
   *
   * for await (const receipt of transport.sendMany(messages)) {
   *   if (receipt.successful) {
   *     console.log('Sent:', receipt.messageId);
   *   } else {
   *     console.error('Failed:', receipt.errorMessages);
   *   }
   * }
   * ```
   *
   * @param messages An iterable or async iterable of messages to send.
   * @param options Optional SMTP envelope, delivery status, and cancellation
   *                settings.
   * @returns An async iterable of receipts, one for each message.
   * @throws {DOMException} If the operation is aborted through
   *                        `options.signal`.
   */
  async *sendMany(messages, options) {
    options?.signal?.throwIfAborted();

    // The connection is taken for the first message that is composed, so a
    // batch of nothing, or of messages that cannot be composed, takes none.
    let connection;
    // A setup that failed, including authentication, fails every message.
    let setupError;
    let connectionValid = true;

    try {
      // for await takes a synchronous iterable as well.
      let index = 0;
      for await (const message of messages) {
        options?.signal?.throwIfAborted();

        let smtpMessage;
        try {
          const envelope = resolveEnvelopeOption(message, options?.envelope, index++);
          const dsn = resolveSmtpDsn(envelope, options?.dsn);
          smtpMessage = prepareMessage(message, this.config.dkim, dsn, envelope, this.config);
        } catch (error) {
          // A message that cannot be composed never reaches the connection.
          yield createSmtpFailure(error instanceof Error ? error.message : String(error), error);
          continue;
        }

        if (setupError !== undefined) {
          const errorMessage =
            setupError instanceof Error ? setupError.message : String(setupError);
          yield createSmtpFailure(errorMessage, setupError);
          continue;
        }

        if (!connectionValid) {
          yield createSmtpFailure('Connection is no longer valid');
          continue;
        }

        if (connection == null) {
          try {
            connection = await this.getConnection(options?.signal);
          } catch (error) {
            // Cancellation rejects rather than producing receipts.
            options?.signal?.throwIfAborted();
            setupError = error;
            yield createSmtpFailure(error instanceof Error ? error.message : String(error), error);
            continue;
          }
        }

        try {
          options?.signal?.throwIfAborted();
          const result = await connection.sendMessage(smtpMessage, options?.signal);

          yield {
            successful: true,
            messageId: result.messageId,
            provider: 'smtp',
            rejectedRecipients: result.rejectedRecipients,
          };
        } catch (error) {
          // Cancellation rejects rather than producing a receipt.
          options?.signal?.throwIfAborted();

          if (!connection.usable || !isReusableLocalFailure(error)) {
            connectionValid = false;
          }

          yield createSmtpFailure(error instanceof Error ? error.message : String(error), error);
        }
      }
    } catch (error) {
      // Error during iteration setup or while reading the messages
      connectionValid = false;
      throw error;
    } finally {
      // Runs on normal completion, on error, and when the consumer abandons
      // the iteration early with `break` or `return`.  Without it an abandoned
      // iteration would hold its connection slot forever.
      if (connection != null) {
        if (connectionValid) {
          await this.returnConnection(connection);
        } else {
          await this.discardConnection(connection);
        }
      }
    }
  }

  /**
   * Checks out a connection, waiting when {@link poolSize} connections are
   * already open.  The returned connection holds one of those slots until it is
   * handed back through {@link returnConnection} or {@link discardConnection}.
   *
   * @param signal Signal that cancels the wait for a free connection.
   * @param fresh Whether setup must run on a new connection.
   * @returns A connection ready to send.
   * @throws {DOMException} If `signal` is aborted before a connection is
   *                        obtained.
   */
  async getConnection(signal, fresh = false) {
    signal?.throwIfAborted();
    while (this.closing != null) {
      await this.waitForShutdown(this.closing, signal);
      signal?.throwIfAborted();
    }
    this.pendingAcquisitions++;
    try {
      return await this.acquireConnection(signal, fresh);
    } finally {
      this.pendingAcquisitions--;
      this.notifyDrained();
    }
  }

  waitForShutdown(closing, signal) {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        signal?.removeEventListener('abort', onAbort);
        reject(signal?.reason);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      // oxlint-disable-next-line promise/always-return -- upstream
      closing.then(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      });
    });
  }

  notifyDrained() {
    if (this.openConnectionCount === 0 && this.pendingAcquisitions === 0) {
      this.onDrained?.();
    }
  }

  async acquireConnection(signal, fresh = false) {
    while (true) {
      signal?.throwIfAborted();
      if (fresh && this.openConnectionCount >= this.poolSize) {
        const idle = this.connectionPool.pop();
        if (idle != null) {
          // Transfer this slot without waking a competing acquisition.
          await this.closeConnection(idle, signal);
          return await this.setupReservedConnection(signal);
        }
      }
      // Reuse an idle connection when the pool has one.  It already holds a
      // slot, so nothing else needs to be reserved.
      if (!fresh) {
        const pooled = await this.takePooledConnection(signal);
        if (pooled != null) return pooled;
      }

      if (this.openConnectionCount < this.poolSize) {
        // Reserve the slot before connecting so that connections still being
        // established count towards the limit.
        this.openConnectionCount++;
        return await this.setupReservedConnection(signal);
      }

      // Every slot is taken, so wait for one to come back.
      await this.waitForCapacity(signal);
      try {
        signal?.throwIfAborted();
      } catch (error) {
        // This caller consumed a wake-up it can no longer use; pass it on so
        // that a waiter behind it is not stranded.
        this.wakeCapacityWaiter();
        throw error;
      }
    }
  }

  /**
   * Takes an idle connection from the pool, reset and ready to send, or gives
   * `undefined` when none is left.  One that went stale while idle, or fails
   * its reset, is closed and gives its slot back.
   *
   * @param signal Signal that cancels the reset.
   * @returns A connection ready to send, or `undefined`.
   * @throws The reason of `signal` if it aborts during a reset.
   */
  async takePooledConnection(signal) {
    let pooled = this.connectionPool.pop();
    while (pooled != null) {
      if (pooled.usable) {
        pooled.socket.ref();
        if (!pooled.needsReset) return pooled;
        try {
          await pooled.reset(signal);
          pooled.needsReset = false;
          return pooled;
        } catch {
          // Its state is unknown after a failed or aborted RSET.
          await this.discardConnection(pooled);
          signal?.throwIfAborted();
        }
      } else {
        // Dropping a connection that went stale in the pool frees its slot.
        await this.discardConnection(pooled);
      }
      pooled = this.connectionPool.pop();
    }
    return undefined;
  }

  /** Establishes a connection using a slot already owned by this acquisition. */
  async setupReservedConnection(signal) {
    let connection;
    try {
      signal?.throwIfAborted();
      connection = new SmtpConnection(this.config, this.tokenManager);
      await this.connectAndSetup(connection, signal);
      signal?.throwIfAborted();
      return connection;
    } catch (error) {
      if (connection != null) await this.closeConnection(connection, signal);
      this.releaseConnectionSlot();
      throw error;
    }
  }

  /**
   * Waits until {@link wakeCapacityWaiter} reports that a connection or a free
   * slot may be available.
   *
   * @param signal Signal that cancels the wait.
   * @returns A promise that resolves when the caller should retry.
   * @throws {DOMException} If `signal` is aborted while waiting.
   */
  waitForCapacity(signal) {
    return new Promise((resolve, reject) => {
      const waiters = this.capacityWaiters;
      const onAbort = () => {
        // Dropping the waiter from the queue before rejecting keeps it from
        // consuming a wake-up meant for someone still waiting.
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        waiter.reject(signal?.reason);
      };
      const waiter = {
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        reject: (reason) => {
          signal?.removeEventListener('abort', onAbort);
          reject(reason);
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      waiters.push(waiter);
    });
  }

  /** Wakes the caller that has been waiting longest, if there is one. */
  wakeCapacityWaiter() {
    this.capacityWaiters.shift()?.resolve();
  }

  /**
   * Gives up the slot held by a connection that is no longer open, letting a
   * waiting caller take its place.
   */
  releaseConnectionSlot() {
    this.openConnectionCount--;
    this.wakeCapacityWaiter();
    this.notifyDrained();
  }

  async connectAndSetup(connection, signal) {
    signal?.throwIfAborted();

    await connection.connect(signal);

    signal?.throwIfAborted();

    // Wait for server greeting
    const greeting = await connection.greeting(signal);
    if (greeting.code !== 220) {
      throw new SmtpResponseError(
        `Server greeting failed: ${greeting.message}`,
        greeting.code,
        'GREETING',
        greeting.message,
      );
    }

    signal?.throwIfAborted();

    // Send EHLO
    await connection.ehlo(signal);

    signal?.throwIfAborted();

    // Perform STARTTLS for plaintext connections when either the server
    // advertises it or the caller requires it.  A required upgrade is attempted
    // even without the capability so STARTTLS stripping fails closed.
    if (
      connection.config.secure === false &&
      (connection.config.requireTls === true || connection.hasCapability('STARTTLS'))
    ) {
      await connection.starttls(signal);

      signal?.throwIfAborted();

      // RFC 3207: Client SHOULD send EHLO after successful TLS negotiation
      // to get updated capabilities (including AUTH)
      await connection.ehlo(signal);

      signal?.throwIfAborted();
    }

    // Authenticate if needed
    await connection.authenticate(signal);
  }

  /**
   * Hands a connection back after a successful send, either retaining it for
   * reuse or closing it.  Either way the slot it occupies is passed on to a
   * waiting caller.
   */
  async returnConnection(connection) {
    if (!connection.usable || !connection.config.pool || this.closing != null) {
      await this.discardConnection(connection);
      return;
    }

    // The RSET that clears its state runs when the connection is next taken
    // (takePooledConnection), with that caller's signal: the receipt does not
    // wait for it, and it finds a connection the server dropped while idle.
    connection.needsReset = true;
    // An idle connection does not keep the process alive.
    connection.socket.unref();

    // The connection keeps its slot while it sits idle, so no separate check
    // against `poolSize` is needed here: at most `poolSize` connections can be
    // checked out at once, hence at most `poolSize` can ever be returned.
    this.connectionPool.push(connection);
    this.wakeCapacityWaiter();
  }

  /**
   * Closes a connection without giving up the caller's reserved slot.
   */
  async closeConnection(connection, signal) {
    try {
      await connection.quit(signal);
    } catch {
      // Ignore errors during cleanup
    }
  }

  /** Closes a connection and releases its slot exactly once. */
  async discardConnection(connection, signal) {
    await this.closeConnection(connection, signal);
    this.releaseConnectionSlot();
  }

  /**
   * Closes idle connections and drains sends and verification admitted before
   * this call.
   *
   * Resolves once those sends have released their connections and all their
   * sockets have closed.  Delivery is not interrupted, including sends waiting
   * for capacity or connection setup.  A started `sendMany()` iteration must
   * finish or be returned by its consumer before shutdown can complete.
   *
   * Concurrent close calls share the shutdown. New sends and verification wait for it to
   * finish (and can cancel that wait through their abort signal); the transport
   * can be reused afterward.
   *
   * @returns A promise that resolves after the admitted work is drained.
   *
   * @example
   * ```typescript
   * // At application shutdown
   * await transport.closeAllConnections();
   * ```
   */
  async closeAllConnections() {
    if (this.closing != null) return this.closing;

    let drained;
    const shutdown = new Promise((resolve) => {
      drained = resolve;
    });
    this.onDrained = drained;
    // oxlint-disable-next-line promise/always-return -- upstream
    this.closing = shutdown.then(() => {
      this.onDrained = undefined;
      this.closing = undefined;
    });
    const closing = this.closing;
    const connections = this.connectionPool;
    this.connectionPool = [];

    // Slots remain reserved until their sockets close.  Previously admitted
    // capacity waiters may then send, but must discard their connections too.
    await Promise.all(connections.map((connection) => this.discardConnection(connection)));
    this.notifyDrained();
    await closing;
  }

  /**
   * Implements AsyncDisposable interface for automatic resource cleanup.
   *
   * This method is called automatically when using the `using` keyword,
   * ensuring that all SMTP connections are properly closed when the
   * transport goes out of scope.  Like {@link closeAllConnections}, it waits
   * for admitted sends and started batch iterations to release their connections.
   *
   * @example
   * ```typescript
   * // Automatic cleanup with using statement
   * await using transport = new SmtpTransport(config);
   * await transport.send(message);
   * // Connections are automatically closed here
   * ```
   */
  async [Symbol.asyncDispose]() {
    await this.closeAllConnections();
  }
}

const createSmtpFailure = (message, error) => {
  if (error instanceof SmtpDeliveryUnknownError) {
    return createFailedReceipt(message, {
      provider: 'smtp',
      code: 'smtp.delivery-unknown',
      category: classifyReceiptError(error.cause).category,
      deliveryUnknown: true,
      attempts: 1,
    });
  }
  if (error instanceof RawMessageValidationError) {
    return createFailedReceipt(message, {
      provider: 'smtp',
      category: 'validation',
      retryable: false,
      attempts: 1,
      code: error.field === 'envelope' ? 'smtp.envelope-invalid' : 'smtp.raw-message-invalid',
    });
  }
  if (error instanceof Smtp8BitMimeUnsupportedError) {
    return createFailedReceipt(message, {
      provider: 'smtp',
      category: 'configuration',
      retryable: false,
      attempts: 1,
      code: 'smtp.8bitmime-unsupported',
      providerDetails: { missingCapability: '8BITMIME' },
    });
  }
  if (error instanceof SmtpEnvelopeValidationError) {
    return createFailedReceipt(message, {
      provider: 'smtp',
      code: 'smtp.envelope-invalid',
      category: 'validation',
      retryable: false,
      attempts: 1,
    });
  }

  if (error instanceof SmtpDsnValidationError) {
    return createFailedReceipt(message, {
      provider: 'smtp',
      code: 'smtp.dsn-invalid',
      category: 'validation',
      retryable: false,
      attempts: 1,
    });
  }

  if (error instanceof SmtpDsnUnsupportedError) {
    return createFailedReceipt(message, {
      provider: 'smtp',
      code: 'smtp.dsn-unsupported',
      category: 'configuration',
      retryable: false,
      attempts: 1,
    });
  }

  if (error instanceof SmtpAttachmentReplayError) {
    return createFailedReceipt(message, {
      provider: 'smtp',
      code: 'smtp.attachment-replay-mismatch',
      category: 'validation',
      retryable: false,
      attempts: 1,
    });
  }

  if (error instanceof SmtpMessageSizeError) {
    return createFailedReceipt(message, {
      provider: 'smtp',
      code: 'smtp.message-size-exceeded',
      category: 'rejected',
      retryable: false,
      attempts: 1,
      providerDetails: {
        actualSize: error.actualSize,
        maximumSize: error.maximumSize.toString(),
      },
    });
  }

  if (error instanceof SmtpUtf8UnsupportedError) {
    return createFailedReceipt(message, {
      provider: 'smtp',
      code: 'smtp.smtputf8-unsupported',
      category: 'configuration',
      retryable: false,
      attempts: 1,
      providerDetails: {
        missingCapability: error.missingCapability,
      },
    });
  }

  if (error instanceof SmtpResponseError || error instanceof SmtpAuthResponseError) {
    const enhancedStatusCode = parseEnhancedSmtpStatusCode(error.code, error.response);
    const classification = classifySmtpReply(error.code, enhancedStatusCode);
    return createFailedReceipt(message, {
      provider: 'smtp',
      code: `smtp.${error.code}`,
      category: classification.category,
      retryable: classification.retryable,
      attempts: 1,
      providerDetails: {
        command: error.command,
        response: error.response,
        rejectedRecipients:
          error instanceof SmtpResponseError ? error.rejectedRecipients : undefined,
        ...(enhancedStatusCode == null ? {} : { enhancedStatusCode }),
      },
    });
  }

  return createFailedReceipt(message, {
    provider: 'smtp',
    attempts: 1,
  });
};

const isReusableLocalFailure = (error) => {
  return (
    (error instanceof SmtpMessageSizeError && error.phase === 'preflight') ||
    error instanceof SmtpUtf8UnsupportedError ||
    error instanceof Smtp8BitMimeUnsupportedError ||
    error instanceof RawMessageValidationError ||
    error instanceof SmtpEnvelopeValidationError ||
    error instanceof SmtpDsnValidationError ||
    error instanceof SmtpDsnUnsupportedError
  );
};

const resolveEnvelopeOption = (message, option, index) => {
  let override;
  if (typeof option === 'function') {
    try {
      override = option(message, index);
    } catch (error) {
      const failure = new SmtpEnvelopeValidationError(
        `SMTP envelope resolver failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      failure.cause = error;
      throw failure;
    }
  } else {
    override = option;
  }
  return resolveSmtpEnvelope(message, override);
};

const classifySmtpReply = (code, enhancedStatusCode) => {
  const retryable =
    enhancedStatusCode == null ? code >= 400 && code < 500 : enhancedStatusCode.class === 4;

  if (enhancedStatusCode?.subject === 1 || enhancedStatusCode?.subject === 6) {
    return { category: 'validation', retryable };
  }
  if (enhancedStatusCode?.subject === 4) {
    return { category: 'network', retryable };
  }
  if (code >= 400 && code < 500) {
    return { category: 'service-unavailable', retryable };
  }
  if (code >= 500 && code < 600) {
    return { category: 'rejected', retryable };
  }
  return { category: 'unknown', retryable: false };
};

module.exports = { SmtpTransport };
