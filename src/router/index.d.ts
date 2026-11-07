// Not ported: the types of ./router, a transport that sends each message
// through the transport of its channel.
/// <reference lib="esnext.disposable" />

import type {
  AnyMessage,
  Channel,
  MessageOf,
  RawMessage,
  RawTransport,
  Receipt,
  Transport,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

/** The transport of each channel a router sends, by the name of the channel. */
export type Routes = { readonly [C in Channel]?: Transport<string, MessageOf<C>> };

/** The ids of the transports of some routes. */
type ProviderIdOf<TRoutes extends Routes> = {
  [C in keyof TRoutes]: TRoutes[C] extends Transport<infer P, never> ? P : never;
}[keyof TRoutes];

/** The messages of the channels some routes have. */
type MessageOfRoutes<TRoutes extends Routes> = MessageOf<Extract<keyof TRoutes, Channel>>;

/**
 * A transport of every channel: each message goes through the transport of
 * its `channel` (one without is email), and a message of a channel without
 * a route fails as `unsupported`, not retried.  `sendMany` gives the
 * messages of one channel that come in a row to the `sendMany` of its
 * transport, so a batch API sees them together, and the receipts come in the
 * order of the messages.
 *
 * @example
 * ```js
 * const { createRouter } = require('@alexify/mailer/router');
 *
 * const transport = createRouter({ email: new SesTransport(…), sms: twilio, telegram });
 * await transport.send(createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'Hi' }));
 * ```
 */
export declare class RouterTransport<TRoutes extends Routes = Routes>
  implements
    VerifiableTransport<'router' | ProviderIdOf<TRoutes>, MessageOfRoutes<TRoutes>>,
    AsyncDisposable
{
  readonly id: 'router';
  /**
   * @param routes The transport of each channel.
   * @throws {TypeError} If a route is no transport, or no channel.
   */
  constructor(routes: TRoutes);
  send(
    message: MessageOfRoutes<TRoutes>,
    options?: TransportOptions,
  ): Promise<Receipt<'router' | ProviderIdOf<TRoutes>>>;
  sendMany(
    messages: Iterable<MessageOfRoutes<TRoutes>> | AsyncIterable<MessageOfRoutes<TRoutes>>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'router' | ProviderIdOf<TRoutes>>>;
  /**
   * Sends a raw MIME message through the transport of email; a router
   * without one, or with one that sends none, refuses it.
   */
  sendRaw(
    message: RawMessage,
    options?: TransportOptions,
  ): Promise<Receipt<'router' | ProviderIdOf<TRoutes>>>;
  /**
   * Verifies the transport of each channel that can verify.
   *
   * @throws {AggregateError} With the failure of each that did not verify.
   */
  verify(options?: TransportOptions): Promise<void>;
  /**
   * Disposes of each transport once.
   *
   * @throws {AggregateError} With the failure of each that threw.
   */
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Makes a router: a transport of every channel, which sends each message
 * through the transport of its channel.
 *
 * @throws {TypeError} If a route is no transport, or no channel.
 */
export declare function createRouter<TRoutes extends Routes>(
  routes: TRoutes,
): RouterTransport<TRoutes>;

/** A router whose email route sends raw messages. */
export type RawRouter<TRoutes extends Routes> = RouterTransport<TRoutes> &
  RawTransport<'router' | ProviderIdOf<TRoutes>>;
