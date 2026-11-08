// Not ported: the types of ./twilio, a transport of SMS, MMS, WhatsApp and
// RCS over the Messages API of Twilio.

import type {
  RcsMessage,
  Receipt,
  SmsMessage,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
  WhatsAppMessage,
} from '../../index.js';

/** The messages Twilio sends. */
export type TwilioMessage = SmsMessage | WhatsAppMessage | RcsMessage;

interface TwilioConfigBase extends TransportDependencies {
  /** The account, `AC…`. */
  readonly accountSid: string;
  /** The sender of an SMS: a number in E.164, a short code, or an alphanumeric id. */
  readonly from?: string;
  /** The number of WhatsApp of a sender, in E.164, without `whatsapp:`. */
  readonly whatsappFrom?: string;
  /** The agent of RCS of a sender, without `rcs:`. */
  readonly rcsFrom?: string;
  /** The Messaging Service, `MG…`, which chooses the sender of a message without one. */
  readonly messagingServiceSid?: string;
  /**
   * The URL Twilio tells the statuses of a message to, the
   * `metadata.correlationId` of each in its query (`?correlationId=…`), which
   * the signature of a callback covers.
   */
  readonly statusCallback?: string;
  /** The region that processes the messages, `us1`, `ie1` or `au1`. @default "us1" */
  readonly region?: 'us1' | 'ie1' | 'au1';
  /** The edge of Twilio the requests go to, such as `dublin`. */
  readonly edge?: string;
  /** The API, in place of the host of the region and the edge. */
  readonly baseUrl?: string;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request Twilio did not take: a 429, a 5xx, or a connection
   * never made.  Never after a timeout or a lost answer: that receipt is of
   * unknown delivery.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 10 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The clock of the validity of a message. @default Date.now */
  readonly now?: () => number;
}

/** The options of {@link TwilioTransport}: an auth token, or an API key. */
export type TwilioConfig = TwilioConfigBase &
  (
    | { readonly authToken: string; readonly apiKey?: undefined }
    | {
        readonly apiKey: { readonly sid: string; readonly secret: string };
        readonly authToken?: undefined;
      }
  );

/**
 * A transport of SMS, MMS, WhatsApp and RCS over the Messages API of Twilio.
 * A message goes to its recipient with the prefix of its channel
 * (`whatsapp:`, `rcs:`), from its `from`, the sender of its channel or the
 * Messaging Service; its text is the `Body`, its media the URLs of an MMS
 * (ten at most), its `template` the ContentSid (`HX…`) of a template of the
 * Content API with the variables of its first component, and `expiresAt`
 * its `ValidityPeriod`.  `payload` holds the fields of the form over those,
 * but `To`, `From` and `Body`.  Buttons (a template carries them), media as
 * bytes and a text over 1600 characters are refused before any request.
 *
 * An error is told by its code: a STOP (21610) is `opted-out`, an invalid or
 * a landline number (21211, 21614) `invalid-recipient`, a region not enabled
 * (21408) `configuration`, a message outside the window of WhatsApp (63016)
 * `outside-window`, a recipient not on it (63003) `not-on-channel`.  The
 * receipt says `state: 'accepted'`, its id the sid of the message and its
 * `segments` the `num_segments` Twilio counted; the delivery comes to the
 * status callback.
 *
 * @example
 * ```js
 * const { TwilioTransport } = require('@alexify/mailer/twilio');
 * const twilio = new TwilioTransport({
 *   accountSid: process.env.TWILIO_ACCOUNT_SID,
 *   authToken: process.env.TWILIO_AUTH_TOKEN,
 *   messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
 * });
 * ```
 */
export declare class TwilioTransport implements VerifiableTransport<'twilio', TwilioMessage> {
  readonly id = 'twilio';
  constructor(config: TwilioConfig);
  send(message: TwilioMessage, options?: TransportOptions): Promise<Receipt<'twilio'>>;
  sendMany(
    messages: Iterable<TwilioMessage> | AsyncIterable<TwilioMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'twilio'>>;
  /** Verifies the credentials by reading the account. */
  verify(options?: TransportOptions): Promise<void>;
}
