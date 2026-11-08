// Not ported: the types of ./aws-sms, a transport of SMS over AWS End User
// Messaging SMS.

import type {
  Receipt,
  SmsMessage,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

/** The credentials of AWS, those of a role with its session token among them. */
export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

/**
 * The options of {@link AwsSmsTransport}.
 */
export interface AwsSmsConfig extends TransportDependencies {
  /**
   * The credentials, or a function that gives them at each attempt, such as
   * one of `@aws-sdk/credential-providers` for the credentials of a role,
   * which it renews.
   */
  readonly credentials: AwsCredentials | (() => AwsCredentials | Promise<AwsCredentials>);
  /** @default "us-east-1" */
  readonly region?: string;
  /** The sender of an SMS without `from`: a number, a sender id, a pool, or their ARN. */
  readonly originationIdentity?: string;
  /** The configuration set whose event destinations tell the deliveries. */
  readonly configurationSetName?: string;
  /** The type of an SMS of normal priority; `high` is transactional, `low` promotional. @default "TRANSACTIONAL" */
  readonly messageType?: 'TRANSACTIONAL' | 'PROMOTIONAL';
  /** @default "https://sms-voice.<region>.amazonaws.com" */
  readonly baseUrl?: string;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request AWS did not take: a throttling, a 5xx, or a
   * connection never made.  Never after a timeout or a lost answer: that
   * receipt is of unknown delivery.
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
 * A transport of SMS over AWS End User Messaging SMS (`SendTextMessage` of
 * pinpoint-sms-voice-v2), each attempt signed with SigV4.  An SMS goes from
 * its `from` or the `originationIdentity`, as a `TRANSACTIONAL` or
 * `PROMOTIONAL` message by its priority, `expiresAt` its `TimeToLive` (five
 * seconds to three days), its `metadata` the `Context` its events give back
 * (five keys, `correlationId` first), and `payload` the fields of the body
 * over those (`MaxPrice`, `ProtectConfigurationId`, `DryRun`), but the
 * number and the text.  An MMS, buttons and a text over 1600 characters are
 * refused before any request.
 *
 * An error is told by its reason, then its type: a number opted out is
 * `opted-out`, a destination not verified in the sandbox, a country blocked
 * or the spend limit reached `configuration`, a throttling or a quota
 * `rate-limit`.  The receipt says `state: 'accepted'`, the `MessageId` its
 * id and its segments as a carrier counts them.
 *
 * @example
 * ```js
 * const { AwsSmsTransport } = require('@alexify/mailer/aws-sms');
 * const sms = new AwsSmsTransport({
 *   credentials: { accessKeyId, secretAccessKey },
 *   region: 'eu-west-1',
 *   configurationSetName: 'transactional',
 * });
 * ```
 */
export declare class AwsSmsTransport implements VerifiableTransport<'aws-sms', SmsMessage> {
  readonly id = 'aws-sms';
  constructor(config: AwsSmsConfig);
  send(message: SmsMessage, options?: TransportOptions): Promise<Receipt<'aws-sms'>>;
  sendMany(
    messages: Iterable<SmsMessage> | AsyncIterable<SmsMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'aws-sms'>>;
  /** Verifies the credentials and the region by describing the configuration sets. */
  verify(options?: TransportOptions): Promise<void>;
}
