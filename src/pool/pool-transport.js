// Ported from upyo v0.7.0 (packages/pool/src/pool-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { combineSignals } = require('../core/abort-signal.js');
const { pinMessageId } = require('../core/message-id.js');
const { createLog } = require('../internal/log.js');
const { createFailedReceipt, createReceiptError } = require('../core/receipt.js');
const { createPoolConfig } = require('./config.js');
const { RoundRobinStrategy } = require('./strategies/round-robin-strategy.js');
const { WeightedStrategy } = require('./strategies/weighted-strategy.js');
const { PriorityStrategy } = require('./strategies/priority-strategy.js');
const { SelectorStrategy } = require('./strategies/selector-strategy.js');

/**
 * Pool transport that combines multiple transports with various load balancing
 * and failover strategies.
 *
 * This transport implements the same `Transport` interface, making it a drop-in
 * replacement for any single transport. It distributes messages across multiple
 * underlying transports based on the configured strategy.
 *
 * @example Round-robin load balancing
 * ```typescript
 * import { PoolTransport } from "@alexify/mailer/pool";
 *
 * const transport = new PoolTransport({
 *   strategy: "round-robin",
 *   transports: [
 *     { transport: mailgunTransport },
 *     { transport: sendgridTransport },
 *     { transport: sesTransport },
 *   ],
 * });
 * ```
 *
 * @example Priority-based failover
 * ```typescript
 * const transport = new PoolTransport({
 *   strategy: "priority",
 *   transports: [
 *     { transport: primaryTransport, priority: 100 },
 *     { transport: backupTransport, priority: 50 },
 *     { transport: lastResortTransport, priority: 10 },
 *   ],
 * });
 * ```
 *
 * @example Custom routing with selectors
 * ```typescript
 * const transport = new PoolTransport({
 *   strategy: "selector-based",
 *   transports: [
 *     {
 *       transport: bulkEmailTransport,
 *       selector: (msg) => msg.tags?.includes("newsletter"),
 *     },
 *     {
 *       transport: transactionalTransport,
 *       selector: (msg) => msg.priority === "high",
 *     },
 *     { transport: defaultTransport }, // Catches everything else
 *   ],
 * });
 * ```
 */
class PoolTransport {
  id = 'pool';

  /**
   * The resolved configuration used by this pool transport.
   */
  config;

  strategy;

  /**
   * Creates a new PoolTransport instance.
   *
   * @param config Configuration options for the pool transport.
   * @throws {Error} If the configuration is invalid.
   */
  constructor(config) {
    this.config = createPoolConfig(config);
    this.log = createLog(this.config.logger, { transport: 'pool' });
    this.strategy = this.createStrategy(this.config.strategy);
  }

  /**
   * Sends a single email message using the pool strategy.
   *
   * The transport is selected based on the configured strategy. If the
   * selected transport fails, the pool will retry with other transports
   * up to the configured retry limit.
   *
   * @param message The email message to send.
   * @param options Optional transport options including abort signal.
   * @returns A promise that resolves to a receipt indicating success or failure.
   */
  async send(message, options) {
    const pinned = pinMessageId(message, this.config.generateId);
    const attemptedIndices = new Set();
    const errorMessages = [];
    const errors = [];
    let checkCallerAbortBeforeFailure = false;
    // Failover stops when another transport could only deliver the message a
    // second time (delivery unknown) or would refuse it too (the message
    // itself was rejected).
    let deliveryUnknown = false;
    let isRejected = false;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      // Check for cancellation
      options?.signal?.throwIfAborted();

      // Select a transport
      const selection = this.strategy.select(pinned, this.config.transports, attemptedIndices);

      if (!selection) {
        // No more transports available
        break;
      }

      attemptedIndices.add(selection.index);

      let abortedByCaller = false;
      try {
        // Apply timeout if configured
        const sendOptions = this.createSendOptions(options);

        let receipt;
        try {
          receipt = await selection.entry.transport.send(pinned, sendOptions.options);
        } catch (error) {
          if (sendOptions.abortedByCaller() && isCallerAbort(error, options?.signal)) {
            abortedByCaller = true;
          }
          throw error;
        } finally {
          sendOptions.cleanup();
        }

        if (receipt.successful) {
          return receipt;
        }

        // Collect error messages for failed attempts
        errorMessages.push(...receipt.errorMessages);
        errors.push(...getReceiptErrors(receipt, selection.entry.transport.id));
        checkCallerAbortBeforeFailure = true;
        deliveryUnknown = receipt.deliveryUnknown === true;
        isRejected = hasMessageRejection(receipt.errors);
        if (deliveryUnknown || isRejected) break;
        this.log.write(
          'debug',
          () => ({ attempt: attempt + 1, failed: selection.entry.transport.id }),
          'Pool failing over',
        );
      } catch (error) {
        // Handle transport errors
        if (abortedByCaller && isCallerAbort(error, options?.signal)) {
          throw error;
        }

        const thrownErrors = getThrownReceiptErrors(error, selection.entry.transport.id);
        if (thrownErrors.length > 0) {
          errorMessages.push(...thrownErrors.map((item) => item.message));
          errors.push(...thrownErrors);
          checkCallerAbortBeforeFailure = true;
          isRejected = hasMessageRejection(thrownErrors);
          if (isRejected) break;
          continue;
        }

        const timeoutMessage = 'Transport send timed out.';
        const abortError = isAbortError(error);
        const errorMessage = abortError
          ? timeoutMessage
          : error instanceof Error
            ? error.message
            : String(error);
        errorMessages.push(errorMessage);
        errors.push(
          createReceiptError(errorMessage, {
            provider: selection.entry.transport.id,
            category: abortError ? 'timeout' : undefined,
            retryable: abortError ? false : undefined,
          }),
        );
        checkCallerAbortBeforeFailure ||= !abortError;
        // A send cut short by the pool's timeout may already have been
        // accepted: switching transports could deliver the message twice.
        if (abortError) {
          deliveryUnknown = true;
          break;
        }
      }
    }

    // All attempts failed
    if (checkCallerAbortBeforeFailure) {
      options?.signal?.throwIfAborted();
    }

    return createFailedReceipt(
      errorMessages.length > 0 ? errorMessages : ['All transports failed to send the message.'],
      {
        provider: 'pool',
        errors: errors.length > 0 ? errors : undefined,
        attempts: attemptedIndices.size,
        deliveryUnknown,
        retryable: isRejected ? false : undefined,
      },
    );
  }

  /**
   * Sends multiple email messages using the pool strategy.
   *
   * Each message is sent individually using the `send` method, respecting
   * the configured strategy and retry logic.
   *
   * @param messages An iterable or async iterable of messages to send.
   * @param options Optional transport options including abort signal.
   * @returns An async iterable of receipts, one for each message.
   */
  async *sendMany(messages, options) {
    // Reset strategy state for batch operations
    this.strategy.reset();

    for await (const message of messages) {
      options?.signal?.throwIfAborted();

      yield await this.send(message, options);
    }
  }

  /**
   * Disposes of all underlying transports that support disposal.
   *
   * This method is called automatically when using the `await using` syntax.
   * It ensures proper cleanup of resources held by the underlying transports.
   */
  async [Symbol.asyncDispose]() {
    const disposals = [];
    // A transport listed twice is disposed of once.
    const seen = new WeakSet();
    for (const entry of this.config.transports) {
      const transport = entry.transport;
      if (seen.has(transport)) continue;
      seen.add(transport);
      disposals.push(dispose(transport));
    }

    // Every transport is disposed of, whichever fails; the failures come
    // together afterwards rather than being dropped.
    const errors = [];
    for (const result of await Promise.allSettled(disposals)) {
      if (result.status === 'rejected') errors.push(result.reason);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `Failed to dispose of ${errors.length} pooled transports.`);
    }
  }

  /**
   * Creates a strategy instance based on the strategy type or returns the provided strategy.
   */
  createStrategy(strategy) {
    // If it's already a Strategy instance, return it directly
    if (typeof strategy === 'object' && strategy !== null) {
      return strategy;
    }

    // Handle built-in strategy names
    switch (strategy) {
      case 'round-robin':
        return new RoundRobinStrategy();
      case 'weighted':
        return new WeightedStrategy({ random: this.config.random });
      case 'priority':
        return new PriorityStrategy({ random: this.config.random });
      case 'selector-based':
        return new SelectorStrategy({
          random: this.config.random,
          // A selector that throws is a bug of the application: it skips its
          // transport, as upstream did, and is told to the logger.
          onSelectorError: (error, index) =>
            this.log.write(
              'warn',
              () => ({ index, error: error instanceof Error ? error.message : String(error) }),
              'A pool selector threw; its transport is skipped',
            ),
        });
      default:
        throw new Error(`Unknown strategy: ${strategy}`);
    }
  }

  /**
   * Creates send options with timeout if configured.
   */
  createSendOptions(options) {
    if (!this.config.timeout) {
      return {
        options,
        abortedByCaller: () => options?.signal?.aborted ?? false,
        cleanup: () => {},
      };
    }

    // Create AbortController for timeout
    const timeoutController = new AbortController();
    let abortSource;
    const timeoutId = setTimeout(() => {
      abortSource ??= 'timeout';
      timeoutController.abort(createAbortError());
    }, this.config.timeout);
    let cleanupAbortSource = () => {};
    let signal = timeoutController.signal;
    let cleanupCombinedSignal = () => {};

    // Combine with existing signal if present
    if (options?.signal) {
      const markCallerAbort = () => {
        abortSource ??= 'caller';
        clearTimeout(timeoutId);
      };
      if (options.signal.aborted) {
        markCallerAbort();
      } else {
        options.signal.addEventListener('abort', markCallerAbort, {
          once: true,
        });
      }
      cleanupAbortSource = () => options.signal?.removeEventListener('abort', markCallerAbort);

      const combinedSignal = combineSignals(timeoutController.signal, options.signal);
      signal = combinedSignal.signal;
      cleanupCombinedSignal = combinedSignal.cleanup;
    }

    // Clean up timeout when done
    timeoutController.signal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
    });

    return {
      options: {
        ...options,
        signal,
      },
      abortedByCaller: () => abortSource === 'caller',
      cleanup: () => {
        clearTimeout(timeoutId);
        cleanupAbortSource();
        cleanupCombinedSignal();
      },
    };
  }
}

const createAbortError = () => {
  return new DOMException('The operation was aborted.', 'AbortError');
};

const isCallerAbort = (error, signal) => {
  return signal?.aborted === true && (isAbortError(error) || error === signal.reason);
};

const getReceiptErrors = (receipt, provider) => {
  if (receipt.errors != null && receipt.errors.length > 0) {
    return receipt.errors.map((error) => withReceiptErrorProvider(error, provider));
  }

  return receipt.errorMessages.map((message) =>
    createReceiptError(message, {
      provider: receipt.provider ?? provider,
      retryable: receipt.retryable,
    }),
  );
};

const getThrownReceiptErrors = (error, provider) => {
  if (isReceiptError(error)) {
    return [withReceiptErrorProvider(error, provider)];
  }

  if (isFailedReceipt(error)) {
    return getReceiptErrors(error, provider);
  }

  return [];
};

const withReceiptErrorProvider = (error, provider) => {
  return {
    message: error.message,
    code: error.code,
    category: error.category,
    retryable: error.retryable,
    provider: error.provider ?? provider,
    statusCode: error.statusCode,
    retryAfterMilliseconds: error.retryAfterMilliseconds,
    providerDetails: error.providerDetails,
  };
};

const isReceiptError = (value) => {
  return (
    typeof value === 'object' &&
    value != null &&
    typeof value.message === 'string' &&
    typeof value.code === 'string' &&
    typeof value.retryable === 'boolean' &&
    typeof value.category === 'string'
  );
};

const isFailedReceipt = (value) => {
  return (
    typeof value === 'object' &&
    value != null &&
    value.successful === false &&
    Array.isArray(value.errorMessages)
  );
};

const isAbortError = (error) => {
  return error instanceof Error && error.name === 'AbortError';
};

// A rejection of the message itself, as opposed to one of the transport
// (authentication, rate limit, outage), which another transport may not share.
const hasMessageRejection = (errors) => {
  if (errors == null) return false;
  for (const error of errors) {
    if (error.category === 'validation' || error.category === 'rejected') return true;
  }
  return false;
};

// Disposes of a transport, asynchronously or not; an error it throws at once
// rejects rather than stopping the disposal of the others.
const dispose = async (transport) => {
  if (typeof transport[Symbol.asyncDispose] === 'function') {
    await transport[Symbol.asyncDispose]();
  } else if (typeof transport[Symbol.dispose] === 'function') {
    transport[Symbol.dispose]();
  }
};

module.exports = { PoolTransport };
