// Ported from upyo v0.7.0 (packages/pool/src/pool-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { combineSignals } = require('../core/abort-signal.js');
const { pinMessageId } = require('../core/message-id.js');
const { isRawTransport, isVerifiableTransport } = require('../core/transport.js');
const { refuseRaw } = require('../internal/capabilities.js');
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

  // The entries of sendRaw(), made at its first call: the configuration does
  // not change, and the raw transports among it neither.
  #raw;

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
    return this.#deliver(
      pinned,
      this.config.transports,
      (transport, sendOptions) => transport.send(pinned, sendOptions),
      options,
    );
  }

  /**
   * Sends serialized MIME through the transports that send raw messages, with
   * the strategy and the failover of `send()`.  A selector is not asked, as it
   * judges a `Message`; with no such transport the receipt is a failure of
   * the category `configuration`.
   *
   * @param message The serialized message and its envelope.
   * @param options Optional transport options including abort signal.
   * @returns The receipt of the first transport that sent it, or a failure.
   */
  async sendRaw(message, options) {
    options?.signal?.throwIfAborted();
    const raw = this.#rawEntries();
    if (raw.enabled === 0) return refuseRaw(this);
    return this.#deliver(
      message,
      raw.entries,
      (transport, sendOptions) => transport.sendRaw(message, sendOptions),
      options,
    );
  }

  #rawEntries() {
    if (this.#raw !== undefined) return this.#raw;
    const entries = [];
    let enabled = 0;
    for (const entry of this.config.transports) {
      const canSend = entry.enabled && isRawTransport(entry.transport);
      if (canSend) enabled++;
      entries.push({ ...entry, enabled: canSend, selector: undefined });
    }
    this.#raw = { entries, enabled };
    return this.#raw;
  }

  /**
   * Verifies every enabled transport, all at once, and tells how each did:
   * `verified`, `failed` with its error, or `unverifiable` for one without
   * `verify()`.  It never throws for a transport, so that a key a provider
   * revoked shows while the others still send.
   *
   * @param options Optional abort signal.
   * @returns `{ id, index, status, error? }` for each enabled transport.
   */
  async verifyAll(options) {
    options?.signal?.throwIfAborted();
    const pending = [];
    const results = [];
    for (let index = 0; index < this.config.transports.length; index++) {
      const entry = this.config.transports[index];
      if (!entry.enabled) continue;
      const result = { id: entry.transport.id, index, status: 'unverifiable' };
      results.push(result);
      if (!isVerifiableTransport(entry.transport)) continue;
      pending.push(
        (async () => {
          try {
            await entry.transport.verify(options);
            result.status = 'verified';
          } catch (error) {
            result.status = 'failed';
            result.error = error;
          }
        })(),
      );
    }
    await Promise.all(pending);
    options?.signal?.throwIfAborted();
    return results;
  }

  /**
   * Verifies the enabled transports that can verify, all at once: the pool
   * can send when one of them can.  It throws an `AggregateError` of their
   * errors when none verifies, and has nothing to check when none can verify.
   * {@link PoolTransport.verifyAll} tells how each did.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    const verifying = [];
    for (const entry of this.config.transports) {
      if (entry.enabled && isVerifiableTransport(entry.transport)) {
        verifying.push(entry.transport.verify(options));
      }
    }
    if (verifying.length === 0) return;
    const results = await Promise.allSettled(verifying);
    options?.signal?.throwIfAborted();
    const errors = [];
    for (const result of results) {
      if (result.status === 'fulfilled') return;
      errors.push(result.reason);
    }
    throw new AggregateError(errors, 'No transport of the pool verified.');
  }

  /**
   * Sends a message through the transports the strategy picks, one after
   * another until one sends it or failover has to stop.
   */
  async #deliver(message, entries, sendOnce, options) {
    const attemptedIndices = new Set();
    // Failover stops when another transport could only deliver the message a
    // second time (delivery unknown) or would refuse it too (the message
    // itself was rejected).  A message one transport cannot send as it is
    // (`unsupported`) goes on to the next, which may.
    const failure = {
      errorMessages: [],
      errors: [],
      checkCallerAbort: false,
      deliveryUnknown: false,
      isRejected: false,
    };

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      options?.signal?.throwIfAborted();
      const selection = this.strategy.select(message, entries, attemptedIndices);
      // No more transports available
      if (!selection) break;
      attemptedIndices.add(selection.index);

      const receipt = await this.attempt(selection, sendOnce, options, failure);
      if (receipt?.successful) return receipt;
      if (failure.deliveryUnknown || failure.isRejected) break;
      if (receipt !== undefined) {
        this.log.write(
          'debug',
          () => ({ attempt: attempt + 1, failed: selection.entry.transport.id }),
          'Pool failing over',
        );
      }
    }
    // All attempts failed
    if (failure.checkCallerAbort) options?.signal?.throwIfAborted();
    const { errorMessages, errors } = failure;
    return createFailedReceipt(
      errorMessages.length > 0 ? errorMessages : ['All transports failed to send the message.'],
      {
        provider: 'pool',
        errors: errors.length > 0 ? errors : undefined,
        attempts: attemptedIndices.size,
        deliveryUnknown: failure.deliveryUnknown,
        retryable: failure.isRejected ? false : undefined,
      },
    );
  }

  /**
   * Sends a message through the selected transport once, under the pool's
   * timeout, and records a failure.
   *
   * @param selection The selected transport and its index.
   * @param sendOnce Sends the message through a transport, once.
   * @param options The options of the caller.
   * @param failure What the failed attempts have gathered, updated in place.
   * @returns The receipt of the transport, or `undefined` when it threw.
   * @throws The caller's abort reason when the caller aborts.
   */
  async attempt(selection, sendOnce, options, failure) {
    const transportId = selection.entry.transport.id;
    const sendOptions = this.createSendOptions(options);
    let receipt;
    try {
      receipt = await sendOnce(selection.entry.transport, sendOptions.options);
    } catch (error) {
      if (sendOptions.abortedByCaller() && isCallerAbort(error, options?.signal)) throw error;
      recordThrown(failure, error, transportId);
      return undefined;
    } finally {
      sendOptions.cleanup();
    }
    if (!receipt.successful) {
      for (const text of receipt.errorMessages) failure.errorMessages.push(text);
      appendReceiptErrors(failure.errors, receipt, transportId);
      failure.checkCallerAbort = true;
      failure.deliveryUnknown = receipt.deliveryUnknown === true;
      failure.isRejected = hasMessageRejection(receipt.errors);
    }
    return receipt;
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
    // The strategy goes on from where the sends before left it: reset here,
    // round-robin sent every batch of one message through the first
    // transport, and concurrent batches reset each other.
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
    let cleanupAbortSource = noop;
    let signal = timeoutController.signal;
    let cleanupCombinedSignal = noop;

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

const noop = () => {};

const createAbortError = () => {
  return new DOMException('The operation was aborted.', 'AbortError');
};

const isCallerAbort = (error, signal) => {
  return signal?.aborted === true && (isAbortError(error) || error === signal.reason);
};

// Appends the structured errors of a failed receipt, or ones made from its
// messages, each naming the transport.
const appendReceiptErrors = (target, receipt, provider) => {
  if (receipt.errors != null && receipt.errors.length > 0) {
    for (const error of receipt.errors) target.push(withReceiptErrorProvider(error, provider));
    return;
  }
  for (const message of receipt.errorMessages) {
    target.push(
      createReceiptError(message, {
        provider: receipt.provider ?? provider,
        retryable: receipt.retryable,
      }),
    );
  }
};

const getThrownReceiptErrors = (error, provider) => {
  const errors = [];
  if (isReceiptError(error)) errors.push(withReceiptErrorProvider(error, provider));
  else if (isFailedReceipt(error)) appendReceiptErrors(errors, error, provider);
  return errors;
};

/**
 * Records what a transport threw: a receipt error or a failed receipt as it
 * is, anything else as an error of its own, and the pool's timeout as a send
 * whose delivery is unknown.
 *
 * @param failure What the failed attempts have gathered, updated in place.
 * @param error What the transport threw.
 * @param transportId The id of the transport.
 */
const recordThrown = (failure, error, transportId) => {
  const thrownErrors = getThrownReceiptErrors(error, transportId);
  if (thrownErrors.length > 0) {
    for (const item of thrownErrors) {
      failure.errorMessages.push(item.message);
      failure.errors.push(item);
    }
    failure.checkCallerAbort = true;
    failure.isRejected = hasMessageRejection(thrownErrors);
    return;
  }
  const abortError = isAbortError(error);
  let errorMessage = 'Transport send timed out.';
  if (!abortError) errorMessage = error instanceof Error ? error.message : String(error);
  failure.errorMessages.push(errorMessage);
  failure.errors.push(
    createReceiptError(errorMessage, {
      provider: transportId,
      category: abortError ? 'timeout' : undefined,
      retryable: abortError ? false : undefined,
    }),
  );
  failure.checkCallerAbort ||= !abortError;
  // A send cut short by the pool's timeout may already have been accepted:
  // switching transports could deliver the message twice.
  if (abortError) failure.deliveryUnknown = true;
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
// (authentication, rate limit, outage) or of what it can express
// (`unsupported`), which another transport may not share.
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
