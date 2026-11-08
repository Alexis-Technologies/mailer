// Not ported: the types of ./webpush, a transport of Web Push to the
// subscriptions of browsers.

import type {
  PushMessage,
  Receipt,
  Transport,
  TransportDependencies,
  TransportOptions,
} from '../../index.js';

/**
 * The VAPID of the application (RFC 8292): the key pair of P-256 whose
 * public key the browser subscribed with (`applicationServerKey`), in
 * base64url, and a contact for the push services.
 */
export interface VapidKeys {
  /** `mailto:` an address, or an `https:` URL. */
  readonly subject: string;
  /** The public key, 65 bytes uncompressed, in base64url. */
  readonly publicKey: string;
  /** The private key, 32 bytes, in base64url. */
  readonly privateKey: string;
}

/**
 * The options of {@link WebPushTransport}.
 */
export interface WebPushConfig extends TransportDependencies {
  /** Checked when the transport is made: the pair, the curve, the subject. */
  readonly vapid: VapidKeys;
  /**
   * The seconds a push service keeps a push not yet delivered, for a push
   * without `expiresAt`.
   * @default 2419200
   */
  readonly ttl?: number;
  /**
   * Whether to push to an endpoint: by default an `https:` URL whose host
   * resolves to public addresses alone, so that a subscription a browser
   * gave, which may name any host, cannot reach this network.
   */
  readonly allowEndpoint?: (endpoint: URL) => boolean | Promise<boolean>;
  /** The lookup of the default check of an endpoint. @default dns.promises.lookup */
  readonly lookup?: (
    host: string,
    options: { all: true; verbatim: true },
  ) => Promise<readonly { readonly address: string; readonly family: number }[]>;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a push the service did not take: a 429 after its
   * `Retry-After`, a 5xx, or a connection never made.  Never after a timeout
   * or a lost answer: that receipt is of unknown delivery.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 10 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The clock of the expiry of a push and of the JWTs. @default Date.now */
  readonly now?: () => number;
}

/**
 * A transport of Web Push.  A push goes to a subscription, `{ endpoint,
 * keys: { p256dh, auth } }` as `PushManager.subscribe()` gives it, as one
 * record of aes128gcm (RFC 8291) of the JSON the service worker reads:
 * `{ title, body, image, data, actions }` of its `title`, `text`, one picture
 * at a URL, `data` and buttons (`{ action, title }`, and `url` for a link),
 * with the fields of `payload` over them but `topic`, which is the `Topic` of
 * the push (a push of the same topic replaces one not yet delivered).
 * `expiresAt` is its `TTL`, the priority its `Urgency`, and the JWT of VAPID
 * is held per origin for twelve hours.
 *
 * A push of more than 3993 bytes, the most a body of 4096 bytes carries, is
 * refused before any request; so is an endpoint `allowEndpoint` refuses, and
 * a subscription whose keys are not those of P-256, as `invalid-recipient`.
 * A subscription gone (404, 410) is `unregistered`: drop it.  The receipt
 * says `state: 'sent'`, its id the `Location` of the message, or an id of
 * `generateId` when the service names none.
 *
 * @example
 * ```js
 * const { WebPushTransport } = require('@alexify/mailer/webpush');
 * const webpush = new WebPushTransport({ vapid: { subject: 'mailto:ops@example.com', publicKey, privateKey } });
 * await webpush.send(createChannelMessage({ channel: 'push', to: subscription, title: 'Shipped' }));
 * ```
 */
export declare class WebPushTransport implements Transport<'webpush', PushMessage> {
  readonly id = 'webpush';
  constructor(config: WebPushConfig);
  send(message: PushMessage, options?: TransportOptions): Promise<Receipt<'webpush'>>;
  sendMany(
    messages: Iterable<PushMessage> | AsyncIterable<PushMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'webpush'>>;
}
