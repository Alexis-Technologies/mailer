// Not ported: the types of ./fcm, a transport of push notifications over
// Firebase Cloud Messaging HTTP v1.

import type {
  PushMessage,
  Receipt,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

/** The JSON of a service account of Google, as its console gives it. */
export interface GoogleServiceAccount {
  readonly type?: 'service_account';
  readonly project_id?: string;
  readonly client_email: string;
  readonly private_key: string;
  readonly private_key_id?: string;
  readonly [key: string]: unknown;
}

/**
 * The options of {@link FcmTransport}.
 */
export interface FcmConfig extends TransportDependencies {
  /**
   * The service account of the Firebase project, with the role Firebase Cloud
   * Messaging API Admin: its token is asked for once and shared until five
   * minutes before its end.  Its `token_uri` is not followed.
   */
  readonly serviceAccount: GoogleServiceAccount;
  /** @default the project_id of serviceAccount */
  readonly projectId?: string;
  /**
   * The API, https (or http to this machine).
   * @default "https://fcm.googleapis.com"
   */
  readonly baseUrl?: string;
  /** @default "https://oauth2.googleapis.com/token" */
  readonly tokenUrl?: string;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request FCM did not take: a 429 or a 503 after its
   * `Retry-After`, a 500, or a connection never made.  Never after a timeout
   * or a lost answer, after which FCM may have taken it: that receipt is of
   * unknown delivery.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 10 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The clock of the expiry of a push and of the token. @default Date.now */
  readonly now?: () => number;
}

/**
 * A transport of push notifications over FCM HTTP v1.  A push goes to a
 * token or a topic (not to a subscription of Web Push, which `./webpush`
 * sends), its `title` and `text` as the notification, one picture at a URL as
 * its image, and its `data`, whose keys FCM keeps for itself (`from`,
 * `notification`, `message_type`, `google.…`, `gcm.…`) are refused before any
 * request.  A `high` or `low` priority and `expiresAt` go to each platform:
 * Android's `priority` and `ttl`, the `apns-priority` and `apns-expiration`
 * of APNs, the `Urgency` and `TTL` of Web Push.  `payload` holds the fields
 * of the message over those, merged key by key (`android.notification`,
 * `apns.payload`, `fcm_options`), but its target.
 *
 * A refusal is told by the `errorCode` of its FcmError first: a token
 * unregistered, or one that is no token of FCM, is `unregistered` (drop it),
 * `SENDER_ID_MISMATCH` `invalid-recipient`, `QUOTA_EXCEEDED` `rate-limit`,
 * `THIRD_PARTY_AUTH_ERROR` `configuration`.  The receipt says `state:
 * 'sent'`, the `name` of the message its id.
 *
 * @example
 * ```js
 * const { FcmTransport } = require('@alexify/mailer/fcm');
 * const fcm = new FcmTransport({ serviceAccount: JSON.parse(process.env.FCM_SERVICE_ACCOUNT) });
 * await fcm.send(createChannelMessage({
 *   channel: 'push', to: { token: device.token }, title: 'Shipped', text: 'Order A-1',
 * }));
 * ```
 */
export declare class FcmTransport implements VerifiableTransport<'fcm', PushMessage> {
  readonly id = 'fcm';
  constructor(config: FcmConfig);
  send(message: PushMessage, options?: TransportOptions): Promise<Receipt<'fcm'>>;
  sendMany(
    messages: Iterable<PushMessage> | AsyncIterable<PushMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'fcm'>>;
  /** Verifies the account and the project with a dry run (`validate_only`), which sends nothing. */
  verify(options?: TransportOptions): Promise<void>;
}
