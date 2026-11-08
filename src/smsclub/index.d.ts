// Not ported: the types of ./smsclub, a transport of SMS over the JSON API of
// SMS Club.

import type {
  Receipt,
  SmsMessage,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

/**
 * The options of {@link SmsClubTransport}.
 */
export interface SmsClubConfig extends TransportDependencies {
  /** The token of the account, sent as a Bearer token. */
  readonly token: string;
  /** The alpha name (`src_addr`) of an SMS without `from`. */
  readonly sender?: string;
  /** @default "https://im.smsclub.mobi" */
  readonly baseUrl?: string;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request SMS Club did not take: a 429, a 5xx, or a
   * connection never made.  Never after a timeout or a lost answer: that
   * receipt is of unknown delivery.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once, under its 9 requests a second. @default 5 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A transport of SMS over the JSON API of SMS Club (`/sms/send`).  An SMS
 * goes to its number from its `from` or the transport's `sender`; `payload`
 * holds the fields of the request over those, but the number and the text.
 *
 * The receipt says `state: 'accepted'`, the id of the SMS (the key of the
 * `info` of the answer) its id.  A refusal is told by its status: 400
 * `validation`, 401 `auth`, 429 `rate-limit`, 453 (the same SMS within two
 * minutes) `rejected`.
 *
 * @example
 * ```js
 * const { SmsClubTransport } = require('@alexify/mailer/smsclub');
 * const smsclub = new SmsClubTransport({ token, sender: 'MyBrand' });
 * ```
 */
export declare class SmsClubTransport implements VerifiableTransport<'smsclub', SmsMessage> {
  readonly id = 'smsclub';
  constructor(config: SmsClubConfig);
  send(message: SmsMessage, options?: TransportOptions): Promise<Receipt<'smsclub'>>;
  sendMany(
    messages: Iterable<SmsMessage> | AsyncIterable<SmsMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'smsclub'>>;
  /** Verifies the token by reading the balance of the account. */
  verify(options?: TransportOptions): Promise<void>;
}
