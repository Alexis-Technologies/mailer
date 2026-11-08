// Not ported: the types of ./vonage, a transport of SMS over the SMS API of
// Vonage.

import type {
  Receipt,
  SmsMessage,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

/**
 * The options of {@link VonageTransport}.
 */
export interface VonageConfig extends TransportDependencies {
  readonly apiKey: string;
  readonly apiSecret: string;
  /** The sender of an SMS without `from`: a number or an alphanumeric id. */
  readonly from?: string;
  /** The URL the delivery receipts of the messages go to, in place of the account's. */
  readonly callback?: string;
  /** @default "https://rest.nexmo.com" */
  readonly baseUrl?: string;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request Vonage did not take: a 429, a 5xx, or a connection
   * never made.  Never after a timeout or a lost answer: that receipt is of
   * unknown delivery.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 10 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The clock of the time to live of an SMS. @default Date.now */
  readonly now?: () => number;
}

/**
 * A transport of SMS over the SMS API of Vonage (`/sms/json`).  An SMS goes
 * from its `from` or the transport's, as `unicode` when it is no text of
 * GSM-7, `expiresAt` its `ttl`, the correlation id its `client-ref` (40
 * characters at most), which its delivery receipts give back; `payload`
 * holds the fields of the form over those (`message-class`,
 * `status-report-req`), but the credentials, the number and the text.
 *
 * Vonage answers a part of the message each, in a 200: every part is read.
 * The receipt says `state: 'accepted'`, the id of the first part its id and
 * the `message-count` its segments; a refused part fails it by its status
 * (6 an unroutable number and 33 a number deactivated `invalid-recipient`, 7
 * a number barred `opted-out`, 1 throttled `rate-limit`, 9 a quota spent and
 * 29 a destination not allowed on a trial `configuration`), of unknown
 * delivery when an earlier part went.
 *
 * @example
 * ```js
 * const { VonageTransport } = require('@alexify/mailer/vonage');
 * const vonage = new VonageTransport({ apiKey, apiSecret, from: 'MyBrand' });
 * ```
 */
export declare class VonageTransport implements VerifiableTransport<'vonage', SmsMessage> {
  readonly id = 'vonage';
  constructor(config: VonageConfig);
  send(message: SmsMessage, options?: TransportOptions): Promise<Receipt<'vonage'>>;
  sendMany(
    messages: Iterable<SmsMessage> | AsyncIterable<SmsMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'vonage'>>;
  /** Verifies the key and the secret by reading the balance of the account. */
  verify(options?: TransportOptions): Promise<void>;
}
