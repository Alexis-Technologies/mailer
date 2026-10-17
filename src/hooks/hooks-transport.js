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

const { createFailedReceipt } = require('../core/receipt.js');
const { isRawTransport, isVerifiableTransport } = require('../core/transport.js');
const { warnThrown } = require('../internal/callback.js');
const { refuseRaw } = require('../internal/capabilities.js');
const { gatedSendMany } = require('../internal/gate.js');
const { checkOptionalFunction } = require('../internal/options.js');

const HOOK_FAILED = 'MAILER_HOOK_FAILED';
const HOOKS = ['beforeSend', 'beforeSendRaw', 'afterSend', 'onRetry', 'onError'];

const disposeOf = async (transport) => {
  const target = Object(transport);
  if (typeof target[Symbol.asyncDispose] === 'function') await target[Symbol.asyncDispose]();
  else if (typeof target[Symbol.dispose] === 'function') target[Symbol.dispose]();
};

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
    const context = this.#contextOf('send');
    const before = await this.#before('beforeSend', message, context);
    if (before.receipt !== undefined) return before.receipt;
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
    const context = this.#contextOf('sendRaw');
    const before = await this.#before('beforeSendRaw', message, context);
    if (before.receipt !== undefined) return before.receipt;
    return this.#around(before.message, context, options, (sendOptions) =>
      this.wrappedTransport.sendRaw(before.message, sendOptions),
    );
  }

  /**
   * Sends messages through the `sendMany()` of the wrapped transport, each
   * between its hooks; one `beforeSend` refuses is answered in place.
   */
  sendMany(messages, options) {
    const batch = this.#contextOf('sendMany');
    return gatedSendMany(this.wrappedTransport, messages, this.#optionsOf(options, batch), {
      admit: async (message) => {
        const context = this.#contextOf('sendMany');
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
  async verify(options) {
    options?.signal?.throwIfAborted();
    if (isVerifiableTransport(this.wrappedTransport)) await this.wrappedTransport.verify(options);
  }

  /** Disposes of the wrapped transport when it supports disposal. */
  async [Symbol.asyncDispose]() {
    await disposeOf(this.wrappedTransport);
  }

  #contextOf(operation) {
    return { transportId: this.id, operation, startedAt: this.config.now() };
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
          hook(event, context);
        } catch (error) {
          warnThrown('The onRetry hook of HooksTransport', error, HOOK_FAILED);
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
        receipt: this.#refusal(
          `The ${name} hook refused the message: ${error instanceof Error ? error.message : String(error)}`,
        ),
      };
    }
    if (replaced === undefined) return { message };
    if (replaced === null || typeof replaced !== 'object') {
      return {
        receipt: this.#refusal(`The ${name} hook returned neither a message nor nothing.`),
      };
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

const abandonedError = () =>
  new DOMException(
    'The batch was left before the message was answered; it may have been sent.',
    'AbortError',
  );

module.exports = { HooksTransport };
