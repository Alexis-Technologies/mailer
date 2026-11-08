// Not ported: the types of ./meta, a transport of WhatsApp, Messenger and
// Instagram over the Graph API of Meta.

import type {
  InstagramMessage,
  MessengerMessage,
  Receipt,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
  WhatsAppMessage,
} from '../../index.js';

/** The messages of the channels of Meta. */
export type MetaMessage = WhatsAppMessage | MessengerMessage | InstagramMessage;

/**
 * The options of {@link MetaTransport}: a block for each channel it sends,
 * one at least, each with its token or the shared `accessToken`.
 */
export interface MetaConfig extends TransportDependencies {
  /** The token of the blocks that give none: a system user's, a page's. */
  readonly accessToken?: string;
  /** WhatsApp through the Cloud API: the id of the number of the business. */
  readonly whatsapp?: { readonly phoneNumberId: string; readonly accessToken?: string };
  /** Messenger through the Send API: the id of the page, and its token. */
  readonly messenger?: { readonly pageId: string; readonly accessToken?: string };
  /** Instagram through the Send API: the id of the account (or of its page). */
  readonly instagram?: { readonly accountId: string; readonly accessToken?: string };
  /**
   * The version of the Graph API, which Meta keeps two years each.
   * @default "v23.0" (May 2025)
   */
  readonly graphVersion?: string;
  /**
   * The Graph API, https (or http to this machine).
   * @default "https://graph.facebook.com"
   */
  readonly baseUrl?: string;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request Meta did not take: a rate limit, a service
   * unavailable, or a connection never made.  Never after a timeout or a
   * lost answer: that receipt is of unknown delivery.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 10 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A transport of WhatsApp, Messenger and Instagram over the Graph API.
 *
 * A message of WhatsApp is a text, one medium (a link or the id of a medium
 * uploaded; the text its caption), a `template` WhatsApp approved (what a
 * message outside the 24 hours of the user's last message must be), or
 * interactive: up to three reply buttons, or one link.  Its
 * `metadata.correlationId` is the `biz_opaque_callback_data` the webhooks of
 * its statuses give back.
 *
 * A message of Messenger or Instagram is a `RESPONSE` (the payload sets
 * `messaging_type` and `tag` otherwise) of a text or one attachment;
 * buttons are a button template of Messenger (a link or a postback, three
 * at most) or the quick replies of Instagram; the correlation id is the
 * `metadata` of the message.  `payload` holds the fields of the body over
 * those the transport writes, but the recipient.  What the APIs would
 * refuse (a text over their limits, too many buttons, bytes to upload) fails
 * before any request.
 *
 * An error is told by its code and subcode: a recipient not on WhatsApp
 * (131026) is `not-on-channel`, a message outside the window (131047,
 * 2018278) `outside-window`, a user who stopped marketing (131050)
 * `opted-out`, a person not available (551) `blocked`, a token expired
 * (190) `auth`, a rate limit (4, 613, 130429, 131056) `rate-limit`.  The
 * receipt says `state: 'accepted'`: Meta tells of the delivery through its
 * webhooks.
 *
 * @example
 * ```js
 * const { MetaTransport } = require('@alexify/mailer/meta');
 * const meta = new MetaTransport({
 *   accessToken: process.env.META_SYSTEM_USER_TOKEN,
 *   whatsapp: { phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID },
 * });
 * ```
 */
export declare class MetaTransport implements VerifiableTransport<'meta', MetaMessage> {
  readonly id = 'meta';
  constructor(config: MetaConfig);
  send(message: MetaMessage, options?: TransportOptions): Promise<Receipt<'meta'>>;
  sendMany(
    messages: Iterable<MetaMessage> | AsyncIterable<MetaMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'meta'>>;
  /** Verifies the token of each channel by reading its number, page or account. */
  verify(options?: TransportOptions): Promise<void>;
}
