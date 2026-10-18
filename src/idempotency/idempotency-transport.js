// Ported from unemail v0.7.0 (src/middleware/idempotency.ts): a decorator that
// answers a message whose idempotency key was sent before with the receipt of
// that send.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: the key is reserved before the send, so a second send
// under a key still in flight is not sent, where unemail looked the key up
// before and wrote it after, and two concurrent sends both went; a key used
// again for another message is refused, where unemail answered with the
// first's receipt; a delivery of unknown outcome keeps the key, where unemail
// remembered successes only and a retry sent again; a reservation lasts a
// lease shorter than the time a record is kept, and only the token it was
// given completes or releases it; and a store that fails fails the message it
// was asked about alone.

const { createFailedReceipt } = require('../core/receipt.js');
const { isRawTransport } = require('../core/transport.js');
const { describeThrown, warnThrown } = require('../internal/callback.js');
const { refuseRaw } = require('../internal/capabilities.js');
const { disposeOf, isAbortOf, messageOf, verifyWrapped } = require('../internal/decorator.js');
const { createLog } = require('../internal/log.js');
const { redactAddresses } = require('../internal/redact-addresses.js');
const { gatedSendMany } = require('../internal/gate.js');
const { createIdempotencyConfig } = require('./config.js');
const { fingerprintOf } = require('./fingerprint.js');

const STORE_FAILED = 'MAILER_IDEMPOTENCY_STORE_FAILED';

const isToken = (value) => typeof value === 'string' && value !== '';
const isRecord = (value) => typeof value === 'object' && value !== null;

/**
 * A transport that sends a message with an idempotency key once: a send under
 * a key already used answers with the receipt of the first, or as of unknown
 * delivery while the first is in flight.
 */
class IdempotencyTransport {
  id;
  config;
  wrappedTransport;
  #log;

  /**
   * @param transport The transport to guard.
   * @param config `store`, `leaseMs`, `ttlMs`, `key` and `namespace`.
   * @throws {TypeError} If an option is invalid.
   */
  constructor(transport, config) {
    this.wrappedTransport = transport;
    this.id = transport.id;
    this.config = createIdempotencyConfig(config, transport.id);
    this.#log = createLog(this.config.logger, {
      transport: transport.id,
      decorator: 'idempotency',
    });
  }

  /**
   * Sends one message, unless its key was used before.
   *
   * @returns The receipt of the send, that of the first send under the key,
   * or a failed one: `idempotency.in_flight` (of unknown delivery),
   * `idempotency.key_reused` or `idempotency.store_failed`.
   */
  async send(message, options) {
    options?.signal?.throwIfAborted();
    const entry = await this.#reserve(message);
    if (entry.receipt !== undefined) return entry.receipt;
    return this.#sendReserved(entry, options, (sendOptions) =>
      this.wrappedTransport.send(message, sendOptions),
    );
  }

  /**
   * Sends a raw message, unless the key `key` gives it was used before; a raw
   * message has no `idempotencyKey`, so without `key` it goes as it is.
   */
  async sendRaw(message, options) {
    options?.signal?.throwIfAborted();
    if (!isRawTransport(this.wrappedTransport)) return refuseRaw(this.wrappedTransport);
    const entry = await this.#reserve(message);
    if (entry.receipt !== undefined) return entry.receipt;
    return this.#sendReserved(entry, options, (sendOptions) =>
      this.wrappedTransport.sendRaw(message, sendOptions),
    );
  }

  /**
   * Sends messages through the `sendMany()` of the wrapped transport, one
   * whose key was used before, in this batch too, answered in place.
   */
  sendMany(messages, options) {
    return gatedSendMany(this.wrappedTransport, messages, options, {
      admit: async (message) => {
        const entry = await this.#reserve(message);
        return entry.receipt === undefined ? { message, entry } : { receipt: entry.receipt };
      },
      settle: async (receipt, admitted) => {
        await this.#settle(admitted.entry, receipt);
        return receipt;
      },
      fail: (error, admitted) => this.#thrown(admitted.entry, error, options?.signal),
      abandon: (admitted) => this.#abandon(admitted.entry),
      // A message the wrapped transport never took was not sent: its key is
      // free for the next attempt.
      unsent: (admitted) => this.#release(admitted.entry),
    });
  }

  /** Verifies the wrapped transport. */
  verify(options) {
    return verifyWrapped(this.wrappedTransport, options);
  }

  /** Disposes of the wrapped transport when it supports disposal. */
  async [Symbol.asyncDispose]() {
    await disposeOf(this.wrappedTransport);
  }

  async #sendReserved(entry, options, send) {
    if (options?.signal?.aborted) {
      // Aborted before the send began: nothing went.
      await this.#release(entry);
      options.signal.throwIfAborted();
    }
    let receipt;
    try {
      receipt = await send(options);
    } catch (error) {
      await this.#thrown(entry, error, options?.signal);
      throw error;
    }
    await this.#settle(entry, receipt);
    return receipt;
  }

  // Reserves the key of a message: `{ key, fingerprint, token }` to send
  // under it, `{}` for a message without one, or `{ receipt }` to answer with.
  async #reserve(message) {
    const key = this.config.key === undefined ? message.idempotencyKey : this.config.key(message);
    if (key === undefined || key === null || key === '') return {};
    const storeKey = `${this.config.namespace}:${key}`;
    const fingerprint = fingerprintOf(message);
    let reservation;
    try {
      reservation = await this.config.store.reserve(storeKey, fingerprint, this.config.leaseMs);
    } catch (error) {
      return { receipt: this.#storeFailure(error) };
    }
    const token = reservation?.token;
    const record = reservation?.record;
    // Neither or both is a store that does not keep the contract; sending
    // could send twice, so the message fails as when the store is down.
    if (isToken(token) === isRecord(record)) {
      const error = new TypeError('reserve must resolve to { token } or { record }.');
      return { receipt: this.#storeFailure(error) };
    }
    if (isToken(token)) return { key: storeKey, fingerprint, token };
    return { receipt: this.#replyOf(record, fingerprint, key) };
  }

  #replyOf(record, fingerprint, key) {
    if (record.fingerprint !== fingerprint) {
      this.#log.write(
        'warn',
        () => ({ code: 'idempotency.key_reused', key: redactAddresses(key) }),
        'A key was used again.',
      );
      return createFailedReceipt(
        `The idempotency key ${key} was used for another message; this one was not sent.`,
        {
          provider: this.id,
          category: 'validation',
          retryable: false,
          code: 'idempotency.key_reused',
        },
      );
    }
    if (record.state === 'done' && record.receipt !== undefined) {
      this.#log.write(
        'debug',
        () => ({ code: 'idempotency.hit', key: redactAddresses(key) }),
        'A send was answered as before.',
      );
      return record.receipt;
    }
    this.#log.write(
      'info',
      () => ({ code: 'idempotency.in_flight', key: redactAddresses(key) }),
      'A send of the key is out.',
    );
    // The category is given, as the words of the text, which hold the key,
    // would otherwise choose one (a key `order-timeout-1` made it a timeout,
    // which a circuit breaker counts against the provider).
    return createFailedReceipt(
      `A message with the idempotency key ${key} is being sent; this one was not sent again.`,
      {
        provider: this.id,
        category: 'unknown',
        deliveryUnknown: true,
        code: 'idempotency.in_flight',
      },
    );
  }

  // Retryable, but not a failure of the provider, which a circuit breaker
  // would count.
  #storeFailure(error) {
    return createFailedReceipt(`The idempotency store failed: ${messageOf(error)}`, {
      provider: this.id,
      category: 'unknown',
      retryable: true,
      code: 'idempotency.store_failed',
    });
  }

  // A sent or possibly sent message keeps its key with its receipt; one that
  // failed to go frees it for another attempt.
  async #settle(entry, receipt, ttlMs = this.config.ttlMs) {
    if (entry.key === undefined) return;
    try {
      if (receipt.successful || receipt.deliveryUnknown === true) {
        await this.config.store.complete(
          entry.key,
          entry.token,
          { fingerprint: entry.fingerprint, receipt },
          ttlMs,
        );
      } else {
        await this.config.store.release(entry.key, entry.token);
      }
    } catch (error) {
      // The receipt stands; the key stays reserved until its lease ends.
      this.#storeThrew(error);
    }
  }

  // A message handed to a transport that reads ahead, and left before it was
  // answered, may have gone or not: its key is kept as of unknown delivery
  // for the lease alone, so that a send of it in the next minutes is not
  // made twice, and one after them goes.
  async #abandon(entry) {
    const receipt = createFailedReceipt(
      'The batch was left before the message was answered; whether it went is not known.',
      {
        provider: this.id,
        category: 'unknown',
        deliveryUnknown: true,
        code: 'idempotency.abandoned',
      },
    );
    await this.#settle(entry, receipt, this.config.leaseMs);
  }

  // A send the caller aborted may have gone, so its key is kept as of unknown
  // delivery; one that threw otherwise, a bug before any request most likely,
  // frees it.
  async #thrown(entry, error, signal) {
    if (entry.key === undefined) return;
    if (isAbortOf(error, signal)) {
      const receipt = createFailedReceipt(
        'The send was aborted after it began; whether the message went is not known.',
        {
          provider: this.id,
          category: 'unknown',
          deliveryUnknown: true,
          code: 'idempotency.aborted',
        },
      );
      await this.#settle(entry, receipt);
      return;
    }
    await this.#release(entry);
  }

  async #release(entry) {
    if (entry.key === undefined) return;
    try {
      await this.config.store.release(entry.key, entry.token);
    } catch (error) {
      this.#storeThrew(error);
    }
  }

  // A store that failed after the send: the logger hears of it when there is
  // one, the process otherwise.
  #storeThrew(error) {
    if (!this.#log.hasLogger) {
      warnThrown('The idempotency store', error, STORE_FAILED);
      return;
    }
    this.#log.write(
      'warn',
      () => ({ code: STORE_FAILED, error: describeThrown(error) }),
      'The idempotency store threw.',
    );
  }
}

module.exports = { IdempotencyTransport };
