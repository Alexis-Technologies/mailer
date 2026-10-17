// Ported from unemail v0.7.0 (src/drivers/tee.ts): a transport that sends each
// message through a primary transport and mirrors it to others, the primary's
// receipt the one returned.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: a mirror has a timeout of its own and, by default, its
// send is not awaited, where unemail awaited every leg with no bound, so a
// slow or hung mirror held the primary's receipt; with `awaitMirrors` they
// are awaited, bounded by the timeout; and the detached sends in flight are
// bounded too.

const { isRawTransport, isVerifiableTransport } = require('../core/transport.js');
const { warnThrown } = require('../internal/callback.js');
const { refuseRaw } = require('../internal/capabilities.js');
const { gatedSendMany } = require('../internal/gate.js');
const { createTeeConfig } = require('./config.js');

const disposeOf = async (transport) => {
  const target = Object(transport);
  if (typeof target[Symbol.asyncDispose] === 'function') await target[Symbol.asyncDispose]();
  else if (typeof target[Symbol.dispose] === 'function') target[Symbol.dispose]();
};

const describe = (outcome) => {
  if (outcome.skipped !== undefined) return outcome.skipped;
  if (outcome.error !== undefined) {
    return outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
  }
  return outcome.receipt.errorMessages[0];
};

/**
 * A transport that sends each message through `primary` and mirrors it to
 * `mirrors`, which never change the primary's receipt.
 */
class TeeTransport {
  id;
  config;
  primary;
  #pending = 0;

  /**
   * @param primary The transport whose receipt is returned.
   * @param config `mirrors`, `timeout`, `awaitMirrors`, `maxPending` and
   * `onMirror`.
   * @throws {TypeError} If an option is invalid.
   */
  constructor(primary, config) {
    this.primary = primary;
    this.id = primary.id;
    this.config = createTeeConfig(config);
  }

  /**
   * Sends a message through the primary and mirrors it.
   *
   * @returns The receipt of the primary.
   * @throws What the primary throws.
   */
  async send(message, options) {
    options?.signal?.throwIfAborted();
    const mirrored = this.#mirror(message, options?.signal, 'send');
    const receipt = await this.primary.send(message, options);
    await mirrored;
    return receipt;
  }

  /**
   * Sends a raw message through the primary, mirrored to the mirrors that
   * send raw messages.  A primary without `sendRaw()` gives a failed receipt
   * of the category `configuration`.
   */
  async sendRaw(message, options) {
    options?.signal?.throwIfAborted();
    if (!isRawTransport(this.primary)) return refuseRaw(this.primary);
    const mirrored = this.#mirror(message, options?.signal, 'sendRaw');
    const receipt = await this.primary.sendRaw(message, options);
    await mirrored;
    return receipt;
  }

  /**
   * Sends messages through the `sendMany()` of the primary, each mirrored as
   * it is handed to it.
   */
  sendMany(messages, options) {
    return gatedSendMany(this.primary, messages, options, {
      admit: (message) => ({ message, mirrored: this.#mirror(message, options?.signal, 'send') }),
      settle: async (receipt, admitted) => {
        await admitted.mirrored;
        return receipt;
      },
    });
  }

  /** Verifies the primary; the mirrors are not checked. */
  async verify(options) {
    options?.signal?.throwIfAborted();
    if (isVerifiableTransport(this.primary)) await this.primary.verify(options);
  }

  /**
   * Disposes of the primary and the mirrors, each once, all of them whatever
   * fails; the failures reject together.
   */
  async [Symbol.asyncDispose]() {
    const seen = new Set();
    const errors = [];
    const disposeOnce = async (transport) => {
      if (seen.has(transport)) return;
      seen.add(transport);
      try {
        await disposeOf(transport);
      } catch (error) {
        errors.push(error);
      }
    };
    await disposeOnce(this.primary);
    for (const mirror of this.config.mirrors) await disposeOnce(mirror);
    if (errors.length > 0) throw new AggregateError(errors, 'Disposing of the tee failed.');
  }

  // Starts the sends of the mirrors: awaited by the caller with
  // `awaitMirrors`, otherwise a promise already settled.
  #mirror(message, signal, operation) {
    const sends = [];
    for (const mirror of this.config.mirrors) {
      sends.push(this.#mirrorOne(mirror, message, signal, operation));
    }
    return this.config.awaitMirrors ? Promise.all(sends) : Promise.resolve();
  }

  async #mirrorOne(mirror, message, signal, operation) {
    if (operation === 'sendRaw' && !isRawTransport(mirror)) {
      this.#report({ mirror: mirror.id, message, skipped: 'it does not send raw messages' });
      return;
    }
    const detached = !this.config.awaitMirrors;
    if (detached && this.#pending >= this.config.maxPending) {
      this.#report({
        mirror: mirror.id,
        message,
        skipped: `${this.config.maxPending} mirrored sends are in flight`,
      });
      return;
    }
    // A detached mirror outlives the caller's signal; an awaited one follows it.
    const timeout = AbortSignal.timeout(this.config.timeout);
    const mirrorSignal =
      detached || signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    if (detached) this.#pending++;
    try {
      const receipt = await (operation === 'sendRaw'
        ? mirror.sendRaw(message, { signal: mirrorSignal })
        : mirror.send(message, { signal: mirrorSignal }));
      this.#report({ mirror: mirror.id, message, receipt });
    } catch (error) {
      this.#report({ mirror: mirror.id, message, error });
    } finally {
      if (detached) this.#pending--;
    }
  }

  // Tells `onMirror` of an outcome; without it, a failure becomes a process
  // warning rather than vanishing.
  #report(outcome) {
    const listener = this.config.onMirror;
    if (listener === undefined) {
      if (outcome.receipt?.successful !== true) {
        process.emitWarning(`The mirror ${outcome.mirror} failed: ${describe(outcome)}`, {
          code: 'MAILER_TEE_MIRROR_FAILED',
        });
      }
      return;
    }
    try {
      listener(outcome);
    } catch (error) {
      warnThrown('The onMirror of TeeTransport', error, 'MAILER_TEE_LISTENER_FAILED');
    }
  }
}

module.exports = { TeeTransport };
