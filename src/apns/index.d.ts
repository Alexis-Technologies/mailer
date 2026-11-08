// Not ported: the types of ./apns, a transport of pushes over the Apple Push
// Notification service.

/// <reference lib="esnext.disposable" />

import type {
  PushMessage,
  Receipt,
  Transport,
  TransportDependencies,
  TransportOptions,
} from '../../index.js';

/** A key object of node:crypto, as `createPrivateKey` makes it. */
export interface ApnsKeyObject {
  readonly type: string;
  readonly asymmetricKeyType?: string;
}

/** The options of the TLS connection of the HTTP/2 session. */
export interface ApnsTlsOptions {
  /** The certificates trusted, in place of the roots of the runtime. */
  readonly ca?: string | readonly string[];
  /** @default true */
  readonly rejectUnauthorized?: boolean;
}

/**
 * The options of {@link ApnsTransport}: the token authentication of a team
 * (a key of Apple Push Notifications, its `.p8`).
 */
export interface ApnsConfig extends TransportDependencies {
  /** The ten characters of the team of the developer account. */
  readonly teamId: string;
  /** The ten characters of the id of the key. */
  readonly keyId: string;
  /** The key, the PEM of its `.p8` (PKCS#8, P-256) or a key object. */
  readonly privateKey: string | ApnsKeyObject;
  /** The `apns-topic` of a push: the bundle id of the app. */
  readonly topic: string;
  /**
   * The environment of the tokens of the devices, named, never read from
   * `NODE_ENV`: a token of one is refused by the other.
   */
  readonly environment: 'production' | 'sandbox';
  /** @default "https://api.push.apple.com", or "https://api.sandbox.push.apple.com" */
  readonly baseUrl?: string;
  /** The options of the TLS connection of the HTTP/2 session. */
  readonly tls?: ApnsTlsOptions;
  /** How often an idle session is pinged, in milliseconds. @default 60000 */
  readonly pingIntervalMs?: number;
  /**
   * A `fetch` that speaks HTTP/2, in place of the one of the transport over
   * `node:http2`: Node's own `fetch` speaks HTTP/1.1, which APNs refuses.
   */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request APNs did not take: a 429, an expired token (with a
   * new one), or a connection never made.  Never after a 5xx, a timeout or a
   * lost answer: that receipt is of unknown delivery.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once, streams of one session. @default 10 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The clock of the token and of the expiry of a push. @default Date.now */
  readonly now?: () => number;
}

/** The payload of a push of APNs, the shape of `apns` of FCM. */
export interface ApnsPayload {
  /** Header fields of APNs: `apns-push-type`, `apns-collapse-id`, `apns-topic`… */
  readonly headers?: Readonly<Record<`apns-${string}`, string>>;
  /** The JSON over the payload of the push, merged key by key: `aps.sound`, `aps.badge`… */
  readonly payload?: Readonly<Record<string, unknown>>;
}

/**
 * A transport of pushes over the Apple Push Notification service, through
 * one HTTP/2 session of its origin.  A push goes to the token of a device,
 * its `title` and `text` as `aps.alert`, its `data` at the root of the
 * payload; one that holds no alert, badge or sound is of type `background`,
 * with `content-available` and priority 5, as Apple asks.  A `high` or `low`
 * priority is `apns-priority` 10 or 5, `expiresAt` the `apns-expiration`, and
 * the idempotency key the `apns-id`; `payload` holds the header fields of
 * APNs and the JSON over the payload.  A payload over 4 KB (5 KB for VoIP),
 * media and buttons are refused before any request.
 *
 * The token of the team is signed once for 55 minutes and shared.  A
 * refusal is told by its reason: `Unregistered` and `ExpiredToken` are
 * `unregistered` (drop the token), `BadDeviceToken` and
 * `DeviceTokenNotForTopic` `invalid-recipient`, `TooManyRequests`
 * `rate-limit`.  The receipt says `state: 'sent'`, the `apns-id` its id.
 *
 * @example
 * ```js
 * const { ApnsTransport } = require('@alexify/mailer/apns');
 * const apns = new ApnsTransport({
 *   teamId: 'ABCDE12345', keyId: 'KEY1234567', privateKey: process.env.APNS_KEY,
 *   topic: 'com.example.app', environment: 'production',
 * });
 * ```
 */
export declare class ApnsTransport implements Transport<'apns', PushMessage>, AsyncDisposable {
  readonly id = 'apns';
  constructor(config: ApnsConfig);
  send(message: PushMessage, options?: TransportOptions): Promise<Receipt<'apns'>>;
  sendMany(
    messages: Iterable<PushMessage> | AsyncIterable<PushMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'apns'>>;
  /** Closes the HTTP/2 sessions, the pushes out on them let finish. */
  [Symbol.asyncDispose](): Promise<void>;
}
