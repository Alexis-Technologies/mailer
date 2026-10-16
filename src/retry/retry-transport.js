// Ported from upyo v0.7.0 (packages/retry/src/retry-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const {
  classifyReceiptError,
  createFailedReceipt,
  createReceiptError,
} = require('../core/receipt.js');
const { combineSignals } = require('../core/abort-signal.js');
const { pinMessageId } = require('../core/message-id.js');
const { createRetryConfig } = require('./config.js');

/**
 * Transport decorator that retries transient delivery failures.
 */
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

    const pinned = pinMessageId(message);
    let lastThrownError;
    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      options?.signal?.throwIfAborted();

      let receipt;
      try {
        receipt = await this.wrappedTransport.send(pinned, options);
      } catch (error) {
        options?.signal?.throwIfAborted();

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
    const iterator = toAsyncIterator(messages);
    const inFlight = new Map();
    const completed = new Map();
    let inputDone = false;
    let nextLaunchIndex = 0;
    let nextYieldIndex = 0;
    let launchPromise;
    let launchError;
    let hasLaunchError = false;
    let hasQueuedFailure = false;
    let pullingInput = false;
    let closed = false;
    const controller = new AbortController();
    const combinedSignal = combineSignals(controller.signal, options?.signal);
    const sendOptions = {
      ...options,
      signal: combinedSignal.signal,
    };

    const launchNext = async () => {
      if (inputDone) return;
      combinedSignal.signal.throwIfAborted();

      pullingInput = true;
      let inputPull;
      try {
        inputPull = Promise.resolve(iterator.next());
      } catch (error) {
        inputPull = Promise.reject(error);
      }
      inputPull = inputPull.finally(() => {
        pullingInput = false;
      });
      const next = await raceWithAbort(inputPull, combinedSignal.signal);
      if (closed) return;
      if (next.done) {
        inputDone = true;
        return;
      }

      const index = nextLaunchIndex++;
      if (index > 0) await this.waitBetweenSendMany(combinedSignal.signal);
      if (closed) return;
      const promise = this.send(next.value, sendOptions).then(
        (receipt) => ({
          index,
          successful: true,
          receipt,
        }),
        (error) => ({
          index,
          successful: false,
          error,
        }),
      );
      inFlight.set(index, promise);
    };

    const startLaunch = () => {
      if (
        launchPromise != null ||
        inputDone ||
        hasLaunchError ||
        hasQueuedFailure ||
        inFlight.size >= this.config.sendMany.maxConcurrent
      ) {
        return;
      }

      launchPromise = launchNext()
        .catch((error) => {
          launchError = error;
          hasLaunchError = true;
        })
        .finally(() => {
          launchPromise = undefined;
        });
    };

    try {
      startLaunch();

      while (
        inFlight.size > 0 ||
        completed.has(nextYieldIndex) ||
        // oxlint-disable-next-line no-unmodified-loop-condition -- upstream
        launchPromise != null ||
        // oxlint-disable-next-line no-unmodified-loop-condition -- upstream
        !inputDone
      ) {
        combinedSignal.signal.throwIfAborted();

        while (completed.has(nextYieldIndex)) {
          const result = completed.get(nextYieldIndex);
          completed.delete(nextYieldIndex);
          if (result == null) break;
          if (!result.successful) throw result.error;
          yield result.receipt;
          nextYieldIndex++;
          startLaunch();
        }

        if (hasLaunchError && inFlight.size <= 0) throw launchError;

        startLaunch();
        if (inFlight.size <= 0 && launchPromise == null) break;

        const launch = launchPromise?.then(() => ({
          launched: true,
        }));
        const result = await raceWithAbort(
          Promise.race([...inFlight.values(), ...(launch == null ? [] : [launch])]),
          combinedSignal.signal,
        );
        if ('launched' in result) continue;
        inFlight.delete(result.index);
        completed.set(result.index, result);
        if (!result.successful) hasQueuedFailure = true;
        startLaunch();
      }
      if (hasLaunchError) throw launchError;
    } finally {
      closed = true;
      controller.abort(new DOMException('The operation was aborted.', 'AbortError'));
      launchPromise?.catch(() => {});
      try {
        const closeIterator = () => (inputDone ? undefined : iterator.return?.());
        const closePromise = closeIterator();
        if (pullingInput) {
          closePromise?.catch(() => {});
        } else {
          await closePromise;
        }
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
    return errors?.some((error) => error.retryable) ?? false;
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

  waitBeforeRetry(context, signal) {
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
  return failure.errors?.find((error) => error.retryAfterMilliseconds != null)
    ?.retryAfterMilliseconds;
};

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
