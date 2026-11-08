// Not ported: a transport of every channel, which sends each message through
// the transport of its channel: what the worker of a queue of several
// channels is given, as email has no facade either. A message without a
// channel is an email message, as 1.x made them.

const { createFailedReceipt } = require('../core/receipt.js');
const { CHANNELS } = require('../internal/channel/channels.js');
const { disposeOf, refuseUnlessRaw } = require('../internal/decorator.js');
const { iteratorOf } = require('../internal/iterate.js');
const { isVerifiableTransport } = require('../core/transport.js');

const channelOf = (message) => message?.channel ?? 'email';

const isTransport = (value) =>
  typeof value?.send === 'function' && typeof value?.sendMany === 'function';

const checkRoutes = (routes) => {
  if (typeof routes !== 'object' || routes === null || Array.isArray(routes)) {
    throw new TypeError('A router needs its routes: { email, sms, telegram, … }.');
  }
  const map = new Map();
  for (const channel in routes) {
    if (!Object.hasOwn(routes, channel) || routes[channel] === undefined) continue;
    if (channel !== 'email' && !CHANNELS.has(channel)) {
      throw new TypeError(`A router routes no channel ${JSON.stringify(channel)}.`);
    }
    if (!isTransport(routes[channel])) {
      throw new TypeError(`The route of ${channel} must be a transport, with send and sendMany.`);
    }
    map.set(channel, routes[channel]);
  }
  if (map.size === 0) throw new TypeError('A router needs a route at least.');
  return map;
};

// The receipt of a message a transport never read from its batch: it ended
// its sendMany without taking it, so it was not sent.
const untaken = (channel) =>
  createFailedReceipt(`The transport of ${channel} took no message of its batch.`, {
    provider: 'router',
    category: 'unsupported',
    retryable: false,
    channel,
  });

// The receipt of a message of a channel the router has no transport for:
// another router, or a fallback, may have one.
const unrouted = (channel) =>
  createFailedReceipt(`The router has no transport for ${channel}.`, {
    provider: 'router',
    category: 'unsupported',
    retryable: false,
    channel,
  });

// The messages of one channel that come in a row, read from the input of the
// router as the transport of the channel takes them: its batch API sees them
// together, and the receipts come in the order of the input. `state.head` is
// the next message of the input; `taken`, that it was given and nothing read
// after it, which a transport that stops reading leaves set.
const runOf = async function* (iterator, state, channel) {
  while (!state.head.done && channelOf(state.head.value) === channel) {
    state.taken = true;
    state.handed++;
    yield state.head.value;
    state.head = await iterator.next();
    state.taken = false;
  }
};

class RouterTransport {
  id = 'router';
  #routes;

  /**
   * @param routes The transport of each channel, by its name: `email`,
   * `sms`, `telegram`…
   * @throws {TypeError} If a route is no transport, or no channel.
   */
  constructor(routes) {
    this.#routes = checkRoutes(routes);
  }

  async send(message, options) {
    options?.signal?.throwIfAborted();
    const channel = channelOf(message);
    const transport = this.#routes.get(channel);
    return transport === undefined ? unrouted(channel) : transport.send(message, options);
  }

  async *sendMany(messages, options) {
    const iterator = iteratorOf(messages);
    const state = { head: await iterator.next(), taken: false, handed: 0 };
    try {
      while (!state.head.done) {
        options?.signal?.throwIfAborted();
        const channel = channelOf(state.head.value);
        const transport = this.#routes.get(channel);
        if (transport === undefined) {
          yield unrouted(channel);
          state.head = await iterator.next();
          continue;
        }
        state.handed = 0;
        for await (const receipt of transport.sendMany(runOf(iterator, state, channel), options)) {
          yield receipt;
        }
        // A transport that ended without taking a message would be given the
        // same one again, for ever: it is failed and the next one read.
        if (state.handed === 0) {
          yield untaken(channel);
          state.head = await iterator.next();
          continue;
        }
        // A transport that stopped reading left the message it was given last
        // as the head: the next one is read rather than that one sent again.
        if (state.taken) {
          state.head = await iterator.next();
          state.taken = false;
        }
      }
    } finally {
      if (!state.head.done) await iterator.return?.();
    }
  }

  /** A raw MIME message goes through the transport of email. */
  async sendRaw(message, options) {
    options?.signal?.throwIfAborted();
    const transport = this.#routes.get('email');
    if (transport === undefined) return unrouted('email');
    return refuseUnlessRaw(transport, options) ?? transport.sendRaw(message, options);
  }

  /**
   * Verifies the transport of each channel that can verify; the router is
   * ready only when each is.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    const seen = new Set();
    const verifying = [];
    for (const transport of this.#routes.values()) {
      if (seen.has(transport) || !isVerifiableTransport(transport)) continue;
      seen.add(transport);
      verifying.push(transport.verify(options));
    }
    const errors = [];
    for (const result of await Promise.allSettled(verifying)) {
      if (result.status === 'rejected') errors.push(result.reason);
    }
    options?.signal?.throwIfAborted();
    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} transports of the router did not verify.`);
    }
  }

  /** Disposes of each transport once, whichever fails, the failures together. */
  async [Symbol.asyncDispose]() {
    const seen = new WeakSet();
    const disposals = [];
    for (const transport of this.#routes.values()) {
      if (seen.has(transport)) continue;
      seen.add(transport);
      disposals.push(disposeOf(transport));
    }
    const errors = [];
    for (const result of await Promise.allSettled(disposals)) {
      if (result.status === 'rejected') errors.push(result.reason);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `Failed to dispose of ${errors.length} routed transports.`);
    }
  }
}

/**
 * Makes a router: a transport of every channel, which sends each message
 * through the transport of its channel.
 *
 * @param routes The transport of each channel.
 * @returns The router.
 * @throws {TypeError} If a route is no transport, or no channel.
 */
const createRouter = (routes) => new RouterTransport(routes);

module.exports = { RouterTransport, createRouter };
