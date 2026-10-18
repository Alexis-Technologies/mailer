// Ported from unemail v0.7.0 (src/drivers/tee.ts): a transport that sends each
// message through a primary transport and mirrors it to others, the primary's
// receipt the one returned.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: a mirror has a timeout of its own and, by default, its
// send is not awaited, where unemail awaited every leg with no bound, so a
// slow or hung mirror held the primary's receipt; with `awaitMirrors` they
// are awaited, bounded by the timeout; the detached sends in flight are
// bounded too, and disposal waits for them; the primary and the mirrors send
// one Message-ID; and a failure without `onMirror` is a warning with no
// address in it.

const { pinMessageId } = require('../core/message-id.js');
const { isRawTransport } = require('../core/transport.js');
const { describeThrown, warnLimited, warnThrown } = require('../internal/callback.js');
const { redactAddresses } = require('../internal/redact-addresses.js');
const { disposeOf, refuseUnlessRaw, verifyWrapped } = require('../internal/decorator.js');
const { createLog } = require('../internal/log.js');
const { gatedSendMany } = require('../internal/gate.js');
const { createTeeConfig } = require('./config.js');
const { timerMs } = require('../internal/sleep.js');

const describe = (outcome) => {
  if (outcome.skipped !== undefined) return outcome.skipped;
  if (outcome.error !== undefined) return describeThrown(outcome.error);
  return redactAddresses(outcome.receipt.errorMessages[0] ?? 'no error message');
};

// A send of a mirror that does not settle by `timeout`, as one that ignores
// its signal would not, fails then all the same.
const withDeadline = (sending, timeout, mirror) => {
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`The mirror ${mirror} did not answer within ${timeout} ms.`)),
      timerMs(timeout),
    );
    // A detached send does not keep the process alive; disposal waits for it.
    timer.unref?.();
  });
  return Promise.race([sending, deadline]).finally(() => clearTimeout(timer));
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
  #detached = new Set();
  #log;

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
    this.#log = createLog(this.config.logger, { transport: primary.id, decorator: 'tee' });
  }

  /**
   * Sends a message through the primary, then mirrors it once the primary
   * has answered, whatever it answered; a primary that throws is not
   * mirrored.
   *
   * @returns The receipt of the primary.
   * @throws What the primary throws.
   */
  async send(message, options) {
    options?.signal?.throwIfAborted();
    // The copies are of one message, so they carry one Message-ID.
    const pinned = pinMessageId(message);
    const receipt = await this.primary.send(pinned, options);
    await this.#mirror(pinned, options?.signal, 'send');
    return receipt;
  }

  /**
   * Sends a raw message through the primary, mirrored to the mirrors that
   * send raw messages.  A primary without `sendRaw()` gives a failed receipt
   * of the category `configuration`.
   */
  async sendRaw(message, options) {
    const refusal = refuseUnlessRaw(this.primary, options);
    if (refusal !== undefined) return refusal;
    const receipt = await this.primary.sendRaw(message, options);
    await this.#mirror(message, options?.signal, 'sendRaw');
    return receipt;
  }

  /**
   * Sends messages through the `sendMany()` of the primary, each mirrored
   * once the primary has answered it.
   */
  sendMany(messages, options) {
    return gatedSendMany(this.primary, messages, options, {
      admit: (message) => ({ message: pinMessageId(message) }),
      settle: async (receipt, admitted) => {
        await this.#mirror(admitted.message, options?.signal, 'send');
        return receipt;
      },
    });
  }

  /** Verifies the primary; the mirrors are not checked. */
  verify(options) {
    return verifyWrapped(this.primary, options);
  }

  /**
   * Waits for the mirrored sends in flight, each bounded by `timeout`, then
   * disposes of the primary and the mirrors, each once, all of them whatever
   * fails; the failures reject together.
   */
  async [Symbol.asyncDispose]() {
    await Promise.allSettled(this.#detached);
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
    const timeout = AbortSignal.timeout(timerMs(this.config.timeout));
    const mirrorSignal =
      detached || signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    if (detached) this.#pending++;
    const sending = withDeadline(
      operation === 'sendRaw'
        ? mirror.sendRaw(message, { signal: mirrorSignal })
        : mirror.send(message, { signal: mirrorSignal }),
      this.config.timeout,
      mirror.id,
    );
    const settled = sending.then(
      (receipt) => this.#report({ mirror: mirror.id, message, receipt }),
      (error) => this.#report({ mirror: mirror.id, message, error }),
    );
    if (!detached) {
      await settled;
      return;
    }
    this.#detached.add(settled);
    try {
      await settled;
    } finally {
      this.#detached.delete(settled);
      this.#pending--;
    }
  }

  // Tells `onMirror` of an outcome; without it, a failure becomes a process
  // warning rather than vanishing.
  #report(outcome) {
    const listener = this.config.onMirror;
    if (listener === undefined) {
      if (outcome.receipt?.successful !== true && this.#log.hasLogger) {
        this.#log.write(
          'warn',
          () => ({ code: 'tee.mirror_failed', mirror: outcome.mirror }),
          `The mirror ${outcome.mirror} failed: ${describe(outcome)}`,
        );
      } else if (outcome.receipt?.successful !== true) {
        warnLimited(
          'MAILER_TEE_MIRROR_FAILED',
          `The mirror ${outcome.mirror} failed: ${describe(outcome)}`,
        );
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
