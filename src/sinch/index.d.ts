// Not ported: the types of ./sinch, a transport of SMS over the SMS API of
// Sinch.

import type {
  Receipt,
  SmsMessage,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

/** A region of the SMS API of Sinch, the host of its account. */
export type SinchRegion = 'us' | 'eu' | 'au' | 'br' | 'ca';

/** The delivery reports Sinch posts to the callback of a batch. */
export type SinchDeliveryReport =
  | 'none'
  | 'summary'
  | 'full'
  | 'per_recipient'
  | 'per_recipient_final';

/**
 * The options of {@link SinchTransport}.
 */
export interface SinchConfig extends TransportDependencies {
  readonly servicePlanId: string;
  /** The API token of the service plan, sent as a Bearer token. */
  readonly apiToken: string;
  /** @default "us" */
  readonly region?: SinchRegion;
  /** @default "https://<region>.sms.api.sinch.com" */
  readonly baseUrl?: string;
  /** The sender of an SMS without `from`, else the default originator of the plan. */
  readonly from?: string;
  /** The URL the delivery reports of the messages go to, in place of the plan's. */
  readonly callbackUrl?: string;
  /**
   * The delivery reports asked for.
   * @default "per_recipient" with a `callbackUrl`, else the setting of the plan
   */
  readonly deliveryReport?: SinchDeliveryReport;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request Sinch did not take: a 429, a 5xx, or a connection
   * never made.  Never after a timeout or a lost answer: that receipt is of
   * unknown delivery.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 10 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The clock of the expiry of an SMS. @default Date.now */
  readonly now?: () => number;
}

/**
 * A transport of SMS over the batches of the SMS API of Sinch
 * (`/xms/v1/<servicePlanId>/batches`), a batch of one recipient each.  An
 * SMS goes from its `from` or the transport's, `expiresAt` its `expire_at`
 * within the three days Sinch keeps a batch, the correlation id its
 * `client_reference`, which its delivery reports give back; `payload` holds
 * the fields of the batch over those (`flash_message`,
 * `max_number_of_message_parts`), but the recipients and the text, of 2000
 * characters at most.
 *
 * The receipt says `state: 'accepted'`, the id of the batch its id, and the
 * segments `countSegments` counts, as Sinch tells none.  An error is told by
 * its code, then its status (401 `auth`; 403, 404 and a region not
 * provisioned `configuration`; 429 `rate-limit`).
 *
 * @example
 * ```js
 * const { SinchTransport } = require('@alexify/mailer/sinch');
 * const sinch = new SinchTransport({ servicePlanId, apiToken, region: 'eu', from: 'MyBrand' });
 * ```
 */
export declare class SinchTransport implements VerifiableTransport<'sinch', SmsMessage> {
  readonly id = 'sinch';
  constructor(config: SinchConfig);
  send(message: SmsMessage, options?: TransportOptions): Promise<Receipt<'sinch'>>;
  sendMany(
    messages: Iterable<SmsMessage> | AsyncIterable<SmsMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'sinch'>>;
  /** Verifies the service plan and its token by listing one batch. */
  verify(options?: TransportOptions): Promise<void>;
}
