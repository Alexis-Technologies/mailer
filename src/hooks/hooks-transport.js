// Ported from sently v1.2.2 (src/mailer.ts): hooks around each send of a
// transport — before it, after it, on a retry and on a thrown error.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Also ported from sently v1.2.2 (src/core/hooks.ts): a hook that throws does
// not break the send.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: the context is made for each send, and `onRetry` goes
// in the options of that send, where sently set it on the shared transport,
// so concurrent sends told their retries to each other's hook and one ending
// unset the hook of another; a hook that throws after the send becomes a
// process warning, where sently wrote it with `console.warn` outside
// production and dropped it in production; and `beforeSend` may replace the
// message or refuse it.

const { checkMessage } = require('../core/message.js');
const { createFailedReceipt } = require('../core/receipt.js');
const { isRawTransport } = require('../core/transport.js');
const { warnThrown } = require('../internal/callback.js');
const { refuseRaw } = require('../internal/capabilities.js');
const { disposeOf, messageOf, verifyWrapped } = require('../internal/decorator.js');
const { gatedSendMany } = require('../internal/gate.js');
const { checkOptionalFunction } = require('../internal/options.js');

const HOOK_FAILED = 'MAILER_HOOK_FAILED';
const HOOKS = ['beforeSend', 'beforeSendRaw', 'afterSend', 'onRetry', 'onError'];

/**
 * A transport that calls the hooks of the application around each send of
 * the one it wraps.
 */
class HooksTransport {
  id;
  config;
  wrappedTransport;

  /**
   * @param transport The transport to wrap.
   * @param hooks `beforeSend`, `beforeSendRaw`, `afterSend`, `onRetry`,
   * `onError`, and `now`.
   * @throws {TypeError} If a hook is not a function.
   */
  constructor(transport, hooks = {}) {
    this.wrappedTransport = transport;
    this.id = transport.id;
    const config = {};
    for (const name of HOOKS) config[name] = checkOptionalFunction(hooks[name], name);
    config.now = checkOptionalFunction(hooks.now, 'now') ?? Date.now;
    this.config = config;
  }

  /**
   * Sends one message between its hooks.
   *
   * @returns The receipt of the wrapped transport, or a `rejected` one when
   * `beforeSend` throws.
   * @throws What the wrapped transport throws, after `onError`.
   */
  async send(message, options) {
    options?.signal?.throwIfAborted();
    const context = this.#contextOf('send', options?.signal);
    const before = await this.#before('beforeSend', message, context);
    if (before.receipt !== undefined) return before.receipt;
    // A hook that took its time may outlast the caller's wish to send.
    options?.signal?.throwIfAborted();
    return this.#around(before.message, context, options, (sendOptions) =>
      this.wrappedTransport.send(before.message, sendOptions),
    );
  }

  /**
   * Sends a raw message between `beforeSendRaw` and `afterSend`.  A wrapped
   * transport without `sendRaw()` gives a failed receipt of the category
   * `configuration`.
   */
  async sendRaw(message, options) {
    options?.signal?.throwIfAborted();
    if (!isRawTransport(this.wrappedTransport)) return refuseRaw(this.wrappedTransport);
    const context = this.#contextOf('sendRaw', options?.signal);
    const before = await this.#before('beforeSendRaw', message, context);
    if (before.receipt !== undefined) return before.receipt;
    options?.signal?.throwIfAborted();
    return this.#around(before.message, context, options, (sendOptions) =>
      this.wrappedTransport.sendRaw(before.message, sendOptions),
    );
  }

  /**
   * Sends messages through the `sendMany()` of the wrapped transport, each
   * between its hooks; one `beforeSend` refuses is answered in place.
   */
  sendMany(messages, options) {
    const batch = this.#contextOf('sendMany', options?.signal);
    return gatedSendMany(this.wrappedTransport, messages, this.#optionsOf(options, batch), {
      admit: async (message) => {
        const context = this.#contextOf('sendMany', options?.signal);
        const before = await this.#before('beforeSend', message, context);
        return before.receipt === undefined
          ? { message: before.message, context }
          : { receipt: before.receipt };
      },
      settle: async (receipt, admitted) => {
        await this.#after(receipt, admitted.message, admitted.context);
        return receipt;
      },
      fail: (error, admitted) => this.#error(error, admitted.message, admitted.context),
      // A message the batch was left before it was answered ends with an
      // error, so that each send that began hears of its end.
      abandon: (admitted) => this.#error(abandonedError(), admitted.message, admitted.context),
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

  #contextOf(operation, signal) {
    return { transportId: this.id, operation, startedAt: this.config.now(), signal };
  }

  // The options of one send, its retries told to `onRetry` with its context.
  #optionsOf(options, context) {
    const hook = this.config.onRetry;
    if (hook === undefined) return options;
    const onRetry = options?.onRetry;
    return {
      ...options,
      onRetry: (event) => {
        try {
          // Not awaited, as a retry does not wait for it; a promise that
          // rejects is told all the same.
          const result = hook(event, context);
          if (typeof result?.then === 'function') result.then(undefined, warnRetryHook);
        } catch (error) {
          warnRetryHook(error);
        }
        onRetry?.(event);
      },
    };
  }

  // Runs a before hook: `{ message }` to send, or `{ receipt }` of a refusal.
  async #before(name, message, context) {
    const hook = this.config[name];
    if (hook === undefined) return { message };
    let replaced;
    try {
      replaced = await hook(message, context);
    } catch (error) {
      return {
        receipt: this.#refusal(`The ${name} hook refused the message: ${messageOf(error)}`),
      };
    }
    if (replaced === undefined) return { message };
    if (!isShaped(name, replaced)) {
      return {
        receipt: this.#refusal(`The ${name} hook returned neither a message nor nothing.`),
      };
    }
    // A copy of the message with fields changed did not go through
    // createMessage, which the transports rely on: its checks run again.
    if (name !== 'beforeSendRaw') {
      try {
        checkMessage(replaced);
      } catch (error) {
        return {
          receipt: this.#refusal(
            `The ${name} hook returned an invalid message: ${messageOf(error)}`,
          ),
        };
      }
    }
    return { message: replaced };
  }

  #refusal(text) {
    return createFailedReceipt(text, {
      provider: this.id,
      category: 'rejected',
      retryable: false,
      code: 'hooks.refused',
    });
  }

  async #around(message, context, options, send) {
    let receipt;
    try {
      receipt = await send(this.#optionsOf(options, context));
    } catch (error) {
      await this.#error(error, message, context);
      throw error;
    }
    await this.#after(receipt, message, context);
    return receipt;
  }

  async #after(receipt, message, context) {
    if (this.config.afterSend === undefined) return;
    try {
      await this.config.afterSend(receipt, message, context);
    } catch (error) {
      warnThrown('The afterSend hook of HooksTransport', error, HOOK_FAILED);
    }
  }

  async #error(error, message, context) {
    if (this.config.onError === undefined) return;
    try {
      await this.config.onError(error, message, context);
    } catch (hookError) {
      warnThrown('The onError hook of HooksTransport', hookError, HOOK_FAILED);
    }
  }
}

// What a hook may hand on in place of the message: one of `createMessage`
// for beforeSend, which the converters of the providers rely on to have
// checked its fields, and a raw message with its envelope for beforeSendRaw.
const isShaped = (name, value) => {
  if (value === null || typeof value !== 'object') return false;
  if (name === 'beforeSendRaw') {
    return typeof value.envelope === 'object' && value.envelope !== null;
  }
  return typeof value.sender?.address === 'string' && Array.isArray(value.recipients);
};

const warnRetryHook = (error) =>
  warnThrown('The onRetry hook of HooksTransport', error, HOOK_FAILED);

const abandonedError = () =>
  new DOMException(
    'The batch was left before the message was answered; it may have been sent.',
    'AbortError',
  );

module.exports = { HooksTransport };
