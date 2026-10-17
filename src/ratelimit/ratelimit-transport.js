// Ported from unemail v0.7.0 (src/middleware/rate-limit.ts): a token bucket
// in front of a transport, which waits for its tokens or refuses.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: the waiters are served first in, first out by one
// timer, and a waiter whose caller aborts leaves the queue at once, where
// unemail's sleep did not hear the signal; the longest wait is counted from
// the arrival, so a message is refused at once when the queue ahead of it
// would hold it longer, where unemail started counting only at its turn; a
// cost over the capacity is refused, where unemail cut it to the capacity and
// sent more than the limit; and the buckets of the keys are bounded.

const { createFailedReceipt } = require('../core/receipt.js');
const { isRawTransport, isVerifiableTransport } = require('../core/transport.js');
const { refuseRaw } = require('../internal/capabilities.js');
const { Fifo, gatedSendMany } = require('../internal/gate.js');
const { abortReason } = require('../internal/sleep.js');
const { createRateLimitConfig } = require('./config.js');

const disposeOf = async (transport) => {
  const target = Object(transport);
  if (typeof target[Symbol.asyncDispose] === 'function') await target[Symbol.asyncDispose]();
  else if (typeof target[Symbol.dispose] === 'function') target[Symbol.dispose]();
};

/**
 * A transport that sends through the one it wraps at most `limit` messages
 * every `intervalMs`, with bursts up to `burst`, a bucket per `key`.
 */
class RateLimitTransport {
  id;
  config;
  wrappedTransport;
  #buckets = new Map();
  #sweepAt;
  #refillPerMs;

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
    this.#sweepAt = this.config.maxKeys;
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
  async verify(options) {
    options?.signal?.throwIfAborted();
    if (isVerifiableTransport(this.wrappedTransport)) await this.wrappedTransport.verify(options);
  }

  /** Disposes of the wrapped transport when it supports disposal. */
  async [Symbol.asyncDispose]() {
    await disposeOf(this.wrappedTransport);
  }

  // Takes the tokens of a message, waiting for them: `undefined` once taken,
  // or the receipt of a refusal.
  #admit(message, signal) {
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
    const bucket = this.#bucketOf(keyOf === undefined ? '' : String(keyOf(message)));
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
      return this.#refused(
        `The local rate limit of ${this.id} (${this.config.limit} per ${this.config.intervalMs} ms) ` +
          `would hold the message ${waitMs} ms.`,
        { category: 'rate-limit', retryable: true, retryAfterMilliseconds: waitMs },
      );
    }
    return this.#wait(bucket, cost, signal);
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
      const waiter = { cost, resolve, cancelled: false, signal, onAbort: undefined };
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

  #bucketOf(key) {
    let bucket = this.#buckets.get(key);
    if (bucket === undefined) {
      if (this.#buckets.size >= this.#sweepAt) this.#sweep();
      bucket = {
        tokens: this.config.burst,
        last: this.config.now(),
        waiters: new Fifo(),
        queuedCost: 0,
        timer: undefined,
      };
      this.#buckets.set(key, bucket);
    }
    return bucket;
  }

  // Drops the buckets that are full again and have no waiter: one made anew
  // would be the same.  When too few are, the next sweep waits for twice as
  // many, so a crowd of busy keys does not sweep on every new one.
  #sweep() {
    for (const [key, bucket] of this.#buckets) {
      this.#refill(bucket);
      if (bucket.waiters.size === 0 && bucket.tokens >= this.config.burst) {
        this.#buckets.delete(key);
      }
    }
    this.#sweepAt = Math.max(this.config.maxKeys, this.#buckets.size * 2);
  }
}

module.exports = { RateLimitTransport };
