// Not ported: the types of ./infobip, a transport of SMS over the SMS API of
// Infobip.

import type {
  Receipt,
  SmsMessage,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

/**
 * The options of {@link InfobipTransport}.
 */
export interface InfobipConfig extends TransportDependencies {
  /** The key of the API, sent as `Authorization: App <key>`. */
  readonly apiKey: string;
  /**
   * The base URL of the account: its host (`xyz123.api.infobip.com`), made
   * an https URL, or a URL.
   */
  readonly baseUrl: string;
  /** The sender of an SMS without `from`: a number or an alphanumeric id. */
  readonly from?: string;
  /** The URL the delivery reports of the messages go to, as JSON. */
  readonly notifyUrl?: string;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request Infobip did not take: a 429, a 5xx, or a connection
   * never made.  Never after a timeout or a lost answer: that receipt is of
   * unknown delivery.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 10 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The clock of the validity of an SMS. @default Date.now */
  readonly now?: () => number;
}

/**
 * A transport of SMS over the SMS API of Infobip (`/sms/3/messages`).  An
 * SMS goes from its `from` or the transport's, `expiresAt` its validity
 * period (a minute to 48 hours), the correlation id its `callbackData`,
 * which the delivery reports give back; `payload` holds the fields of the
 * message over those, objects merged one level down (`options.platform`,
 * `content.transliteration`), but the destinations and the text.
 *
 * Infobip answers a status for the message in its 200: one of the groups
 * REJECTED, UNDELIVERABLE or EXPIRED fails it by its name (`REJECTED_DND`
 * `opted-out`, `REJECTED_DESTINATION` and `REJECTED_PREFIX_MISSING`
 * `invalid-recipient`, the sender, the credits or a number not registered
 * on a trial `configuration`, `REJECTED_FLOODING_FILTER` `rate-limit`);
 * otherwise the receipt says `state: 'accepted'`, the `messageId` its id and
 * the `messageCount` its segments.
 *
 * @example
 * ```js
 * const { InfobipTransport } = require('@alexify/mailer/infobip');
 * const infobip = new InfobipTransport({
 *   apiKey,
 *   baseUrl: 'xyz123.api.infobip.com',
 *   from: 'MyBrand',
 * });
 * ```
 */
export declare class InfobipTransport implements VerifiableTransport<'infobip', SmsMessage> {
  readonly id = 'infobip';
  constructor(config: InfobipConfig);
  send(message: SmsMessage, options?: TransportOptions): Promise<Receipt<'infobip'>>;
  sendMany(
    messages: Iterable<SmsMessage> | AsyncIterable<SmsMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'infobip'>>;
  /**
   * Verifies the key by reading the balance of the account; a 403, the
   * answer to a key whose scopes leave out the balance, verifies it too.
   */
  verify(options?: TransportOptions): Promise<void>;
}
