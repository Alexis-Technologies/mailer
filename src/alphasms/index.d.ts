// Not ported: the types of ./alphasms, a transport of SMS and Viber over the
// JSON API of AlphaSMS.

import type {
  Receipt,
  SmsMessage,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
  ViberMessage,
} from '../../index.js';

/**
 * The options of {@link AlphaSmsTransport}.
 */
export interface AlphaSmsConfig extends Omit<TransportDependencies, 'generateId'> {
  /** The key of the JSON API, sent as the `auth` of the body. */
  readonly apiKey: string;
  /** The alpha name (`sms_signature`) of an SMS without `from`. */
  readonly sender?: string;
  /** The signature of a message of Viber without `from`. @default sender */
  readonly viberSender?: string;
  /** The URL the statuses of the messages go to (`hook`). */
  readonly hook?: string;
  /** @default "https://api.alphasms.ua" */
  readonly baseUrl?: string;
  /**
   * The id of a message without an idempotency key, a number, which its
   * statuses give back.
   * @default a random integer below 2^48
   */
  readonly generateId?: () => number;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request AlphaSMS did not take: a 429, a 5xx, or a
   * connection never made.  Never after a timeout or a lost answer: that
   * receipt is of unknown delivery.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 5 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The clock of the lifetime of a message. @default Date.now */
  readonly now?: () => number;
}

/**
 * A transport of SMS and Viber over the JSON API of AlphaSMS
 * (`api/json.php`), to a phone number.  An SMS goes as its text from its
 * `from` or the transport's `sender`, `expiresAt` its `sms_lifetime` (an
 * hour to three days); a message of Viber as a text (1000 characters), a
 * picture, or a text with a picture and a link button; `payload` holds the
 * fields of the item over those: `type: 'viber+sms'` with `sms_message` makes
 * a message of Viber a hybrid, sent as an SMS when Viber does not deliver it.
 * The `id` of an item is a number of its idempotency key.
 *
 * AlphaSMS answers a 200 whose `success`, then that of the item, fails the
 * message, told by the words of its error (`Access denied` `auth`, an error
 * in the alpha name or no money `configuration`).  The receipt says
 * `state: 'accepted'`, the `msg_id` its id and the `parts` its segments.
 *
 * @example
 * ```js
 * const { AlphaSmsTransport } = require('@alexify/mailer/alphasms');
 * const alphasms = new AlphaSmsTransport({ apiKey, sender: 'MyBrand' });
 * ```
 */
export declare class AlphaSmsTransport implements VerifiableTransport<
  'alphasms',
  SmsMessage | ViberMessage
> {
  readonly id = 'alphasms';
  constructor(config: AlphaSmsConfig);
  send(
    message: SmsMessage | ViberMessage,
    options?: TransportOptions,
  ): Promise<Receipt<'alphasms'>>;
  sendMany(
    messages: Iterable<SmsMessage | ViberMessage> | AsyncIterable<SmsMessage | ViberMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'alphasms'>>;
  /** Verifies the key by reading the balance of the account. */
  verify(options?: TransportOptions): Promise<void>;
}
