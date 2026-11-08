// Not ported: the types of ./viber, a transport of messages of a bot over
// the REST Bot API of Viber.

import type {
  Receipt,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
  ViberMessage,
} from '../../index.js';

/**
 * The options of {@link ViberTransport}.
 */
export interface ViberConfig extends TransportDependencies {
  /** The token of the bot, sent as `X-Viber-Auth-Token`. */
  readonly authToken: string;
  /** The sender a message shows: its name (28 characters at most) and avatar. */
  readonly sender: { readonly name: string; readonly avatar?: string };
  /** @default "https://chatapi.viber.com" */
  readonly baseUrl?: string;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request Viber did not take: a 429, a 5xx, or a connection
   * never made.  Never after a timeout or a lost answer: that receipt is of
   * unknown delivery.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 10 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A transport of messages of a bot of Viber, over its REST Bot API
 * (`/pa/send_message`), to the id of a user subscribed to the bot.  A
 * message goes as a text (7000 characters at most) or a picture at its URL
 * with its text as the description (768), its buttons as a keyboard (a link
 * opened, a reply its id sent back), `from` as the name of its sender and the
 * correlation id as its `tracking_data`; `payload` holds the fields of the
 * request over those (`min_api_version`, `rich_media`, a `type` of video or
 * file), but the receiver.
 *
 * Viber answers a 200 whose `status` says whether the message went: 5 and 6,
 * a user not on Viber or not subscribed to the bot, and 11, no device that
 * can take it, are `not-on-channel`; 2 `auth`; 12 `rate-limit`.  The receipt
 * says `state: 'accepted'`, its id the `message_token`, as its text wrote it.
 *
 * @example
 * ```js
 * const { ViberTransport } = require('@alexify/mailer/viber');
 * const viber = new ViberTransport({ authToken, sender: { name: 'Shop' } });
 * ```
 */
export declare class ViberTransport implements VerifiableTransport<'viber', ViberMessage> {
  readonly id = 'viber';
  constructor(config: ViberConfig);
  send(message: ViberMessage, options?: TransportOptions): Promise<Receipt<'viber'>>;
  sendMany(
    messages: Iterable<ViberMessage> | AsyncIterable<ViberMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'viber'>>;
  /** Verifies the token by reading the account of the bot. */
  verify(options?: TransportOptions): Promise<void>;
}
