// Ported from upyo v0.7.0 (packages/retry/src/retry-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const {
  classifyReceiptError,
  createFailedReceipt,
  createReceiptError,
} = require('../core/receipt.js');
const { combineSignals } = require('../core/abort-signal.js');
const { pinMessageId } = require('../core/message-id.js');
const { isRawTransport, isVerifiableTransport } = require('../core/transport.js');
const { refuseRaw } = require('../internal/capabilities.js');
const { createLog } = require('../internal/log.js');
const { createRetryConfig } = require('./config.js');

/**
 * Transport decorator that retries transient delivery failures.
 */
// The built-in errors of a bug in code, such as reading a property of
// undefined, as opposed to a failure of delivery.  A network failure is also
// a TypeError under fetch ("fetch failed"), but its causes classify it.
const PROGRAMMER_ERRORS = [TypeError, RangeError, ReferenceError, SyntaxError];

const isProgrammerError = (error) => {
  for (const type of PROGRAMMER_ERRORS) {
    if (error instanceof type) return classifyReceiptError(error).category === 'unknown';
  }
  return false;
};

class RetryTransport {
  id;

  /**
   * Resolved retry configuration.
   */
  config;

  wrappedTransport;

  /**
   * Creates a retrying transport around another transport.
   *
   * @param transport The transport to wrap.
   * @param config Retry configuration.
   * @throws {RangeError} If retry configuration is invalid.
   */
  constructor(transport, config = {}) {
    this.wrappedTransport = transport;
    this.id = transport.id;
    this.config = createRetryConfig(config);
    this.log = createLog(this.config.logger, { transport: 'retry' });
  }

  /**
   * Sends one message, retrying retryable failures.
   *
   * @param message The message to send.
   * @param options Optional transport options.
   * @returns The final delivery receipt.
   * @throws {DOMException} If the operation is aborted.
   */
  async send(message, options) {
    options?.signal?.throwIfAborted();

    const pinned = pinMessageId(message, this.config.generateId);
    return this.withRetries(
      (sendOptions) => this.wrappedTransport.send(pinned, sendOptions),
      options,
    );
  }

  /**
   * Sends serialized MIME through the wrapped transport, retrying retryable
   * failures as `send()` does; the content of a raw message can be read
   * again.  A wrapped transport without `sendRaw()` gives a failed receipt of
   * the category `configuration`.
   *
   * @param message The serialized message and its envelope.
   * @param options Optional transport options.
   * @returns The final delivery receipt.
   * @throws {DOMException} If the operation is aborted.
   */
  async sendRaw(message, options) {
    options?.signal?.throwIfAborted();
    if (!isRawTransport(this.wrappedTransport)) return refuseRaw(this.wrappedTransport);
    return this.withRetries(
      (sendOptions) => this.wrappedTransport.sendRaw(message, sendOptions),
      options,
    );
  }

  /**
   * Verifies the wrapped transport once, without retries; it has nothing to
   * check when it cannot verify.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    if (isVerifiableTransport(this.wrappedTransport)) await this.wrappedTransport.verify(options);
  }

  /**
   * Sends once, then again while the failure is retryable and attempts are
   * left, waiting between attempts.
   *
   * @param sendOnce Sends the message once with the given options.
   * @param options Optional transport options.
   * @returns The final delivery receipt.
   */
  async withRetries(sendOnce, options) {
    let lastThrownError;
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      options?.signal?.throwIfAborted();

      let receipt;
      try {
        receipt = await sendOnce(options);
      } catch (error) {
        options?.signal?.throwIfAborted();
        // A bug of the wrapped transport is not a delivery failure to retry
        // or to hide in a receipt.
        if (isProgrammerError(error)) throw error;

        lastThrownError = error;
        if (
          attempt >= this.config.maxAttempts ||
          !this.shouldRetryError(error) ||
          this.isRetryAfterBeyondMaxDelay(toReceiptError(error))
        ) {
          return this.createThrownFailure(error, attempt);
        }

        await this.waitBeforeRetry(
          {
            attempt,
            nextAttempt: attempt + 1,
            maxAttempts: this.config.maxAttempts,
            delayMilliseconds: this.calculateDelay(attempt, toReceiptError(error)),
            error,
            reason: 'retry',
          },
          options?.signal,
          options?.onRetry,
        );
        continue;
      }

      options?.signal?.throwIfAborted();

      if (receipt.successful) {
        return this.withSuccessMetadata(receipt, attempt);
      }

      const failedReceipt = this.withFailureMetadata(receipt, attempt);
      if (
        attempt >= this.config.maxAttempts ||
        !this.shouldRetryReceipt(failedReceipt) ||
        this.isRetryAfterBeyondMaxDelay(failedReceipt)
      ) {
        return failedReceipt;
      }

      await this.waitBeforeRetry(
        {
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts: this.config.maxAttempts,
          delayMilliseconds: this.calculateDelay(attempt, failedReceipt),
          receipt: failedReceipt,
          reason: 'retry',
        },
        options?.signal,
        options?.onRetry,
      );
    }

    return this.createThrownFailure(lastThrownError, this.config.maxAttempts);
  }

  /**
   * Sends messages with per-message retry behavior.
   *
   * Receipts are yielded in the same order as input messages.
   *
   * @param messages Messages to send.
   * @param options Optional transport options.
   * @returns An async iterable of receipts.
   * @throws {DOMException} If the operation is aborted.
   */
  async *sendMany(messages, options) {
    const controller = new AbortController();
    const combinedSignal = combineSignals(controller.signal, options?.signal);
    const signal = combinedSignal.signal;
    const run = new SendManyRun(this, toAsyncIterator(messages), { ...options, signal });
    try {
      run.launch();
      while (run.isActive()) {
        signal.throwIfAborted();
        for (let result = run.takeNext(); result !== undefined; result = run.takeNext()) {
          if (!result.successful) throw result.error;
          yield result.receipt;
          run.launch();
        }
        if (run.hasLaunchError && run.inFlight <= 0) throw run.launchError;
        run.launch();
        if (run.inFlight <= 0 && run.launching === undefined) break;
        await raceWithAbort(run.progress(), signal);
        run.launch();
      }
      if (run.hasLaunchError) throw run.launchError;
    } finally {
      run.closed = true;
      controller.abort(new DOMException('The operation was aborted.', 'AbortError'));
      try {
        await run.close();
      } finally {
        combinedSignal.cleanup();
      }
    }
  }

  /**
   * Disposes the wrapped transport when it supports disposal.
   *
   * @throws {unknown} If the wrapped transport's async or sync disposal hook
   *   throws or rejects.
   */
  async [Symbol.asyncDispose]() {
    const wrappedTransport = Object(this.wrappedTransport);
    const asyncDisposeSymbol = Symbol.asyncDispose;
    if (typeof asyncDisposeSymbol === 'symbol') {
      const asyncDispose = wrappedTransport[asyncDisposeSymbol];
      if (typeof asyncDispose === 'function') {
        await asyncDispose.call(wrappedTransport);
        return;
      }
    }

    const disposeSymbol = Symbol.dispose;
    if (typeof disposeSymbol === 'symbol') {
      const dispose = wrappedTransport[disposeSymbol];
      if (typeof dispose === 'function') dispose.call(wrappedTransport);
    }
  }

  withSuccessMetadata(receipt, attempts) {
    return {
      ...receipt,
      provider: receipt.provider ?? this.id,
      attempts,
    };
  }

  withFailureMetadata(receipt, attempts) {
    return {
      ...receipt,
      provider: receipt.provider ?? this.id,
      retryable:
        receipt.deliveryUnknown === true
          ? false
          : (receipt.retryable ?? this.hasRetryableError(receipt.errors)),
      attempts,
    };
  }

  shouldRetryReceipt(receipt) {
    const shouldRetry = this.config.shouldRetry;
    if (shouldRetry != null) {
      return shouldRetry({ kind: 'receipt', receipt });
    }
    // The message may have been accepted: sending it again may deliver it twice.
    if (receipt.deliveryUnknown === true) return false;
    if (receipt.retryable != null) return receipt.retryable;
    return this.hasRetryableError(receipt.errors);
  }

  shouldRetryError(error) {
    const receiptError = toReceiptError(error);
    const shouldRetry = this.config.shouldRetry;
    if (shouldRetry != null) {
      return shouldRetry({
        kind: 'error',
        error,
        receiptError,
      });
    }
    if (receiptError != null) return receiptError.retryable;
    if (error instanceof Error && error.name === 'AbortError') return true;
    return classifyReceiptError(error).retryable;
  }

  hasRetryableError(errors) {
    if (errors == null) return false;
    for (const error of errors) {
      if (error.retryable) return true;
    }
    return false;
  }

  // A server that asks to wait longer than the longest delay is not asked
  // again sooner, where it would most likely refuse again: the failure goes
  // back with its delay, for the caller or a queue to schedule.
  isRetryAfterBeyondMaxDelay(failure) {
    const retryAfterMilliseconds = getRetryAfterMilliseconds(failure);
    return (
      Number.isFinite(retryAfterMilliseconds) &&
      retryAfterMilliseconds > this.config.backoff.maxDelayMilliseconds
    );
  }

  calculateDelay(attempt, failure) {
    const retryAfterMilliseconds = getRetryAfterMilliseconds(failure);
    const cappedRetryAfter =
      retryAfterMilliseconds == null ||
      !Number.isFinite(retryAfterMilliseconds) ||
      retryAfterMilliseconds < 0
        ? undefined
        : Math.min(retryAfterMilliseconds, this.config.backoff.maxDelayMilliseconds);

    if (cappedRetryAfter != null) return cappedRetryAfter;

    const computedDelay = Math.min(
      this.config.backoff.baseDelayMilliseconds * Math.pow(this.config.backoff.factor, attempt - 1),
      this.config.backoff.maxDelayMilliseconds,
    );

    if (this.config.jitter === false || this.config.jitter === 'none') {
      return computedDelay;
    }

    const random = this.config.random;
    return Math.floor(random() * computedDelay);
  }

  waitBeforeRetry(context, signal, onRetry) {
    this.log.write(
      'debug',
      () => ({ attempt: context.attempt, delayMilliseconds: context.delayMilliseconds }),
      'Retrying send',
    );
    onRetry?.({
      attempt: context.attempt,
      delayMilliseconds: context.delayMilliseconds,
      error: context.error ?? context.receipt?.errors?.[0],
    });
    const wait = this.config.wait;
    return wait(context, signal);
  }

  waitBetweenSendMany(signal) {
    const delayMilliseconds = this.config.sendMany.intervalMilliseconds;
    if (delayMilliseconds <= 0) return Promise.resolve();
    const wait = this.config.wait;
    return wait(
      {
        attempt: 0,
        nextAttempt: 0,
        maxAttempts: this.config.maxAttempts,
        delayMilliseconds,
        reason: 'sendMany-throttle',
      },
      signal,
    );
  }

  createThrownFailure(error, attempts) {
    const receiptError = toReceiptError(error);
    if (receiptError != null) {
      return createFailedReceipt(receiptError, {
        provider: receiptError.provider ?? this.id,
        attempts,
      });
    }

    const message = error instanceof Error ? error.message : String(error);
    const classification =
      error instanceof Error && error.name === 'AbortError'
        ? {
            category: 'timeout',
            code: 'timeout',
            retryable: true,
          }
        : classifyReceiptError(error);
    return createFailedReceipt(
      createReceiptError(message, {
        provider: this.id,
        category: classification.category,
        code: classification.code,
        retryable: classification.retryable,
      }),
      {
        provider: this.id,
        attempts,
      },
    );
  }
}

/**
 * Creates a retrying transport around another transport.
 *
 * @param baseTransport The transport to wrap.
 * @param config Retry configuration.
 * @returns A retrying transport decorator.
 * @throws {RangeError} If retry configuration is invalid.
 */
const createRetryTransport = (baseTransport, config = {}) => {
  return new RetryTransport(baseTransport, config);
};

const getRetryAfterMilliseconds = (failure) => {
  if (failure == null) return undefined;
  if (isReceiptError(failure)) return failure.retryAfterMilliseconds;
  if (failure.errors == null) return undefined;
  for (const error of failure.errors) {
    if (error.retryAfterMilliseconds != null) return error.retryAfterMilliseconds;
  }
  return undefined;
};

/**
 * The state of one sendMany() of the retry decorator.  Messages are read and
 * sent up to `maxConcurrent` at a time, and a slot freed by a later message
 * is refilled while an earlier one is still out; a send that finishes waits
 * among the completed ones until the receipts before it are given, and no
 * more than `maxConcurrent` wait, so that a slow first message cannot let the
 * whole input be sent and its receipts held.  Each send that settles, and each
 * launch that ends, wakes the loop through progress(), with no race over the
 * sends in flight.
 */
class SendManyRun {
  inFlight = 0;
  launching = undefined;
  launchError = undefined;
  hasLaunchError = false;
  closed = false;
  #transport;
  #iterator;
  #sendOptions;
  #completed = new Map();
  #nextLaunchIndex = 0;
  #nextYieldIndex = 0;
  #inputDone = false;
  #pullingInput = false;
  #hasQueuedFailure = false;
  #wake = undefined;
  #woken = false;

  /**
   * @param transport The retry decorator.
   * @param iterator The async iterator of the messages.
   * @param sendOptions The options of each send, with the signal of the batch.
   */
  constructor(transport, iterator, sendOptions) {
    this.#transport = transport;
    this.#iterator = iterator;
    this.#sendOptions = sendOptions;
  }

  /** Starts reading and sending the next message, when a slot is free. */
  launch() {
    const maxConcurrent = this.#transport.config.sendMany.maxConcurrent;
    if (
      this.launching !== undefined ||
      this.#inputDone ||
      this.hasLaunchError ||
      this.#hasQueuedFailure ||
      this.inFlight >= maxConcurrent ||
      this.#completed.size >= maxConcurrent
    ) {
      return;
    }
    this.launching = this.#launchNext()
      .catch((error) => {
        this.launchError = error;
        this.hasLaunchError = true;
      })
      .finally(() => {
        this.launching = undefined;
        this.#notify();
      });
  }

  /** The result of the next message in order, once it is there. */
  takeNext() {
    const result = this.#completed.get(this.#nextYieldIndex);
    if (result === undefined) return undefined;
    this.#completed.delete(this.#nextYieldIndex);
    if (result.successful) this.#nextYieldIndex++;
    return result;
  }

  isActive() {
    return (
      this.inFlight > 0 ||
      this.#completed.has(this.#nextYieldIndex) ||
      this.launching !== undefined ||
      !this.#inputDone
    );
  }

  /** Settles at the next send that settles or launch that ends, at once if one did since. */
  progress() {
    if (this.#woken) {
      this.#woken = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => (this.#wake = resolve));
  }

  /** Closes the input unless it ended, without waiting for a read in progress. */
  close() {
    this.launching?.catch(() => {});
    if (this.#inputDone) return undefined;
    const closing = this.#iterator.return?.();
    if (this.#pullingInput) {
      closing?.catch(() => {});
      return undefined;
    }
    return closing;
  }

  #notify() {
    if (this.#wake === undefined) {
      this.#woken = true;
      return;
    }
    const resolve = this.#wake;
    this.#wake = undefined;
    resolve();
  }

  #record(result) {
    this.inFlight--;
    this.#completed.set(result.index, result);
    if (!result.successful) this.#hasQueuedFailure = true;
    this.#notify();
  }

  async #pull() {
    this.#pullingInput = true;
    let inputPull;
    try {
      inputPull = Promise.resolve(this.#iterator.next());
    } catch (error) {
      inputPull = Promise.reject(error);
    }
    const pulled = inputPull.finally(() => {
      this.#pullingInput = false;
    });
    return await raceWithAbort(pulled, this.#sendOptions.signal);
  }

  async #launchNext() {
    if (this.#inputDone) return;
    const signal = this.#sendOptions.signal;
    signal.throwIfAborted();
    const next = await this.#pull();
    if (this.closed) return;
    if (next.done) {
      this.#inputDone = true;
      return;
    }
    const index = this.#nextLaunchIndex++;
    if (index > 0) await this.#transport.waitBetweenSendMany(signal);
    if (this.closed) return;
    this.inFlight++;
    this.#transport.send(next.value, this.#sendOptions).then(
      (receipt) => this.#record({ index, successful: true, receipt }),
      (error) => this.#record({ index, successful: false, error }),
    );
  }
}

const toAsyncIterator = (values) => {
  const asyncIterator = values[Symbol.asyncIterator];
  if (typeof asyncIterator === 'function') return asyncIterator.call(values);

  const iterator = values[Symbol.iterator]();
  return {
    async next() {
      return await Promise.resolve(iterator.next());
    },
    async return(value) {
      return await Promise.resolve(
        iterator.return?.(value) ?? {
          done: true,
          value,
        },
      );
    },
  };
};

const raceWithAbort = (promise, signal) => {
  if (signal.aborted) return Promise.reject(getAbortReason(signal));

  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(getAbortReason(signal));
    };
    const cleanup = () => {
      signal.removeEventListener('abort', abort);
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      // oxlint-disable-next-line promise/always-return -- upstream
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
};

const getAbortReason = (signal) => {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
};

const toReceiptError = (value) => {
  return isReceiptError(value) ? value : undefined;
};

const isReceiptError = (value) => {
  return (
    typeof value === 'object' &&
    value != null &&
    typeof value.message === 'string' &&
    typeof value.code === 'string' &&
    typeof value.category === 'string' &&
    typeof value.retryable === 'boolean'
  );
};

module.exports = { RetryTransport, createRetryTransport };
