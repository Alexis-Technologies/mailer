// Ported from unemail v0.7.0 (src/middleware/rate-limit.ts): a token bucket
// in front of a transport, which waits for its tokens or refuses.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: the waiters are served first in, first out by one
// timer, and a waiter whose caller aborts leaves the queue at once, where
// unemail's sleep did not hear the signal; the longest wait is counted from
// the arrival, so a message is refused at once when the queue ahead of it
// would hold it longer, where unemail started counting only at its turn; a
// cost over the capacity is refused, where unemail cut it to the capacity and
// sent more than the limit; the buckets of the keys are held to `maxKeys`, the
// least used full one dropped first; the waiters of a bucket are held to
// `maxQueue`; and disposal stops the waits.

const { createFailedReceipt } = require('../core/receipt.js');
const { isRawTransport } = require('../core/transport.js');
const { refuseRaw } = require('../internal/capabilities.js');
const { disposeOf, verifyWrapped } = require('../internal/decorator.js');
const { Fifo, gatedSendMany } = require('../internal/gate.js');
const { warnLimited } = require('../internal/warn.js');
const { createLog } = require('../internal/log.js');
const { abortReason, sleep } = require('../internal/sleep.js');
const { createRateLimitConfig } = require('./config.js');

/**
 * A transport that sends through the one it wraps at most `limit` messages
 * every `intervalMs`, with bursts up to `burst`, a bucket per `key`.
 */
class RateLimitTransport {
  id;
  config;
  wrappedTransport;
  // In the order of their last use, the least recent first.
  #buckets = new Map();
  #refillPerMs;
  #disposed = false;
  // Aborts the waits on a shared store when the transport is disposed of.
  #closing = new AbortController();
  #log;

  /**
   * @param transport The transport to throttle.
   * @param config `limit`, `intervalMs`, `burst`, `mode`, `maxWaitMs`, `key`,
   * `cost`, `maxKeys` and `now`.
   * @throws {TypeError} If an option is invalid.
   */
  constructor(transport, config) {
    this.wrappedTransport = transport;
    this.id = transport.id;
    this.config = createRateLimitConfig(config);
    this.#refillPerMs = this.config.limit / this.config.intervalMs;
    this.#log = createLog(this.config.logger, { transport: transport.id, decorator: 'ratelimit' });
  }

  /**
   * Sends one message once the bucket has its tokens.
   *
   * @returns The receipt of the wrapped transport, or a `rate-limit` one when
   * the message would wait longer than `maxWaitMs` (at once in `reject` mode).
   * @throws The reason of the signal if it aborts while the message waits.
   */
  async send(message, options) {
    options?.signal?.throwIfAborted();
    const refusal = await this.#admit(message, options?.signal);
    if (refusal !== undefined) return refusal;
    return this.wrappedTransport.send(message, options);
  }

  /** Sends a raw message once the bucket has its tokens. */
  async sendRaw(message, options) {
    options?.signal?.throwIfAborted();
    if (!isRawTransport(this.wrappedTransport)) return refuseRaw(this.wrappedTransport);
    const refusal = await this.#admit(message, options?.signal);
    if (refusal !== undefined) return refusal;
    return this.wrappedTransport.sendRaw(message, options);
  }

  /**
   * Sends messages through the `sendMany()` of the wrapped transport, each
   * handed to it once the bucket has its tokens, so a batch is throttled like
   * as many sends; one refused is answered in place.
   */
  sendMany(messages, options) {
    return gatedSendMany(this.wrappedTransport, messages, options, {
      admit: async (message) => {
        const refusal = await this.#admit(message, options?.signal);
        return refusal === undefined ? { message } : { receipt: refusal };
      },
    });
  }

  /** Verifies the wrapped transport, without taking tokens. */
  verify(options) {
    return verifyWrapped(this.wrappedTransport, options);
  }

  /**
   * Stops the waits, each send that waits rejecting with an `AbortError`,
   * and disposes of the wrapped transport when it supports disposal.
   */
  async [Symbol.asyncDispose]() {
    this.#disposed = true;
    this.#closing.abort(disposedError());
    const reason = disposedError();
    for (const bucket of this.#buckets.values()) {
      clearTimeout(bucket.timer);
      while (bucket.waiters.size > 0) {
        const waiter = bucket.waiters.shift();
        if (waiter.cancelled) continue;
        waiter.signal?.removeEventListener('abort', waiter.onAbort);
        waiter.reject(reason);
      }
    }
    this.#buckets.clear();
    await disposeOf(this.wrappedTransport);
  }

  // Takes the tokens of a message, waiting for them: `undefined` once taken,
  // or the receipt of a refusal.
  #admit(message, signal) {
    if (this.#disposed) return Promise.reject(disposedError());
    // A signal that aborted between two messages of a batch: the message
    // would take its tokens and go, though the caller stopped.
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    const { cost: costOf, key: keyOf } = this.config;
    const cost = costOf === undefined ? 1 : costOf(message);
    if (typeof cost !== 'number' || !(cost >= 0) || cost === Infinity) {
      return this.#refused(`The cost of a message must be a non-negative number: ${cost}`, {
        category: 'configuration',
        code: 'ratelimit.invalid_cost',
      });
    }
    if (cost > this.config.burst) {
      return this.#refused(
        `The cost ${cost} of the message is over the ${this.config.burst} tokens the bucket holds.`,
        { category: 'configuration', code: 'ratelimit.cost_over_capacity' },
      );
    }
    const key = keyOf === undefined ? '' : String(keyOf(message));
    if (this.config.store !== undefined) return this.#takeShared(key, cost, signal);
    const bucket = this.#bucketOf(key);
    this.#refill(bucket);
    if (bucket.waiters.size === 0 && bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return undefined;
    }
    // Served in turn, this one gets its tokens once those ahead have theirs.
    const waitMs = Math.max(
      1,
      Math.ceil((bucket.queuedCost + cost - bucket.tokens) / this.#refillPerMs),
    );
    if (this.config.mode === 'reject' || waitMs > this.config.maxWaitMs) {
      this.#log.write('info', () => ({ code: 'ratelimit.limited', waitMs }), 'A send was refused.');
      return this.#refused(
        `The local rate limit of ${this.id} (${this.config.limit} per ${this.config.intervalMs} ms) ` +
          `would hold the message ${waitMs} ms.`,
        { category: 'rate-limit', retryable: true, retryAfterMilliseconds: waitMs },
      );
    }
    // However long the waits may be, the queue of a bucket is bounded.
    if (bucket.waiters.size >= this.config.maxQueue) {
      this.#log.write('info', () => ({ code: 'ratelimit.limited', waitMs }), 'A send was refused.');
      return this.#refused(
        `The local rate limit of ${this.id} holds ${this.config.maxQueue} messages waiting already.`,
        { category: 'rate-limit', retryable: true, retryAfterMilliseconds: waitMs },
      );
    }
    this.#log.write('debug', () => ({ code: 'ratelimit.waiting', waitMs }), 'A send waits.');
    return this.#waited(this.#wait(bucket, cost, signal));
  }

  // Takes the tokens from the store the processes share, waiting while it
  // says when they will be there, within `maxWaitMs` of the arrival.
  async #takeShared(key, cost, signal) {
    const { limit, intervalMs, burst } = this.config;
    const waits =
      signal === undefined ? this.#closing.signal : AbortSignal.any([signal, this.#closing.signal]);
    let waited = 0;
    for (;;) {
      const answer = await this.config.store.take(key, cost, { limit, intervalMs, burst });
      if (answer?.taken === true) {
        if (waited > 0) this.#logWaited(waited);
        return undefined;
      }
      // A store that does not say how long is asked again after the time the
      // rate gives the tokens, not polled at every millisecond.
      const told = Number(answer?.waitMs);
      const waitMs = Math.max(
        1,
        Math.ceil(told > 0 && Number.isFinite(told) ? told : cost / this.#refillPerMs),
      );
      if (this.config.mode === 'reject' || waited + waitMs > this.config.maxWaitMs) {
        this.#log.write(
          'info',
          () => ({ code: 'ratelimit.limited', waitMs }),
          'A send was refused.',
        );
        return this.#refused(
          `The shared rate limit of ${this.id} (${limit} per ${intervalMs} ms) would hold the ` +
            `message ${waitMs} ms.`,
          { category: 'rate-limit', retryable: true, retryAfterMilliseconds: waitMs },
        );
      }
      this.#log.write('debug', () => ({ code: 'ratelimit.waiting', waitMs }), 'A send waits.');
      await sleep(waitMs, waits);
      waited += waitMs;
    }
  }

  // Tells the time a send waited for its tokens, once it has them.
  async #waited(waiting) {
    const started = this.config.now();
    await waiting;
    this.#logWaited(this.config.now() - started);
    return undefined;
  }

  #logWaited(waitedMs) {
    this.#log.write('debug', () => ({ code: 'ratelimit.waited', waitedMs }), 'A send waited.');
  }

  #refused(text, options) {
    return Promise.resolve(
      createFailedReceipt(text, {
        provider: this.id,
        retryable: false,
        code: 'ratelimit.limited',
        ...options,
      }),
    );
  }

  #wait(bucket, cost, signal) {
    return new Promise((resolve, reject) => {
      // A signal that aborted before, between two messages of a batch, fires
      // no event: the message would wait and take its tokens.
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      const waiter = { cost, resolve, reject, cancelled: false, signal, onAbort: undefined };
      if (signal !== undefined) {
        waiter.onAbort = () => {
          waiter.cancelled = true;
          bucket.queuedCost -= cost;
          reject(abortReason(signal));
          this.#pump(bucket);
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      bucket.waiters.push(waiter);
      bucket.queuedCost += cost;
      this.#pump(bucket);
    });
  }

  // Serves the waiters in turn, and sets one timer for the next.
  #pump(bucket) {
    clearTimeout(bucket.timer);
    bucket.timer = undefined;
    this.#refill(bucket);
    while (bucket.waiters.size > 0) {
      const head = bucket.waiters.peek();
      if (head.cancelled) {
        bucket.waiters.shift();
        continue;
      }
      if (head.cost > bucket.tokens) {
        const delay = Math.max(1, Math.ceil((head.cost - bucket.tokens) / this.#refillPerMs));
        bucket.timer = setTimeout(() => this.#pump(bucket), delay);
        return;
      }
      bucket.waiters.shift();
      bucket.tokens -= head.cost;
      bucket.queuedCost -= head.cost;
      head.signal?.removeEventListener('abort', head.onAbort);
      head.resolve(undefined);
    }
  }

  #refill(bucket) {
    const now = this.config.now();
    const elapsed = Math.max(0, now - bucket.last);
    bucket.tokens = Math.min(this.config.burst, bucket.tokens + elapsed * this.#refillPerMs);
    bucket.last = now;
  }

  // The bucket of a key, moved to the end of the order of use.
  #bucketOf(key) {
    let bucket = this.#buckets.get(key);
    if (bucket !== undefined) {
      this.#buckets.delete(key);
      this.#buckets.set(key, bucket);
      return bucket;
    }
    if (this.#buckets.size >= this.config.maxKeys) this.#evict();
    bucket = {
      tokens: this.config.burst,
      last: this.config.now(),
      waiters: new Fifo(),
      queuedCost: 0,
      timer: undefined,
    };
    this.#buckets.set(key, bucket);
    return bucket;
  }

  // Makes room for a key: drops the least used buckets that are full, which
  // lose nothing, as a key that comes back starts full; then, if no full one
  // makes room, the least used without a waiter, whose key comes back with
  // more tokens than it had, which is told.  A bucket with waiters is never
  // dropped, so they alone can hold more than `maxKeys`.
  #evict() {
    for (const [key, bucket] of this.#buckets) {
      if (this.#buckets.size < this.config.maxKeys) return;
      if (bucket.waiters.size > 0) continue;
      this.#refill(bucket);
      if (bucket.tokens >= this.config.burst) this.#buckets.delete(key);
    }
    let dropped = 0;
    for (const [key, bucket] of this.#buckets) {
      if (this.#buckets.size < this.config.maxKeys) break;
      if (bucket.waiters.size === 0) {
        this.#buckets.delete(key);
        dropped++;
      }
    }
    if (dropped > 0) this.#tellEvicted(dropped);
  }

  #tellEvicted(dropped) {
    const text =
      `The rate limit of ${this.id} dropped ${dropped} bucket(s) not yet full to hold ` +
      `${this.config.maxKeys} keys: their keys start full again. Raise maxKeys, or use a store.`;
    if (this.#log.hasLogger) {
      this.#log.write('warn', () => ({ code: 'ratelimit.evicted', dropped }), text);
    } else {
      warnLimited('MAILER_RATELIMIT_EVICTED', text);
    }
  }
}

// What a send waiting for tokens rejects with when the transport is disposed of.
const disposedError = () =>
  new DOMException('The rate limit transport was disposed of.', 'AbortError');

module.exports = { RateLimitTransport };
