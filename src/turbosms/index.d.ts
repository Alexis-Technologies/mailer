// Not ported: the types of ./turbosms, a transport of SMS and Viber over the
// HTTP API of TurboSMS.

import type {
  Receipt,
  SmsMessage,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
  ViberMessage,
} from '../../index.js';

/**
 * The options of {@link TurboSmsTransport}.
 */
export interface TurboSmsConfig extends TransportDependencies {
  /** The token of the HTTP API, sent as a Bearer token. */
  readonly token: string;
  /** The alpha name of an SMS without `from`, active in the account. */
  readonly sender?: string;
  /** The sender of a message of Viber without `from`. @default sender */
  readonly viberSender?: string;
  /** @default "https://api.turbosms.ua" */
  readonly baseUrl?: string;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * A request that ran out is sent again under its sequence_id.
   * @default 60000
   */
  readonly timeout?: number;
  /**
   * Retries of a request: a 5xx, a timeout or a lost answer, under the same
   * sequence_id, which TurboSMS executes once.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 5 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The clock of the time to live of Viber. @default Date.now */
  readonly now?: () => number;
}

/**
 * A transport of SMS and Viber over the HTTP API of TurboSMS
 * (`message/send.json`), to a phone number.  An SMS goes as its text (1521
 * characters of GSM-7, 661 of UCS-2, at most) from its `from` or the transport's `sender`; a message of
 * Viber as its text (1000 characters), one picture by URL and one link
 * button, `expiresAt` its `ttl` (30 seconds to a day); `payload` holds the
 * fields of the request over those: `sms` on a message of Viber makes it a
 * hybrid, sent as an SMS when Viber does not deliver it; `start_time`,
 * `is_flash`.
 *
 * Each send carries a `sequence_id` of its own, which TurboSMS executes once
 * in 30 days: a request whose answer was lost is sent again under it, and
 * answered with the results of the first.  TurboSMS answers a 200 whose
 * `response_code`, then that of the recipient, fails the message: 105 and
 * 301 `auth`, 203 (no balance) and a sender not allowed `configuration`,
 * 305 `invalid-recipient`, 404 (the stoplist) `opted-out`, 428 `rate-limit`.
 * The receipt says `state: 'accepted'`, the `message_id` its id.
 *
 * @example
 * ```js
 * const { TurboSmsTransport } = require('@alexify/mailer/turbosms');
 * const turbosms = new TurboSmsTransport({ token, sender: 'MyBrand' });
 * ```
 */
export declare class TurboSmsTransport implements VerifiableTransport<
  'turbosms',
  SmsMessage | ViberMessage
> {
  readonly id = 'turbosms';
  constructor(config: TurboSmsConfig);
  send(
    message: SmsMessage | ViberMessage,
    options?: TransportOptions,
  ): Promise<Receipt<'turbosms'>>;
  sendMany(
    messages: Iterable<SmsMessage | ViberMessage> | AsyncIterable<SmsMessage | ViberMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'turbosms'>>;
  /** Verifies the token by reading the balance of the account. */
  verify(options?: TransportOptions): Promise<void>;
}
