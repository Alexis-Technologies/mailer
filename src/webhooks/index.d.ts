// Types ported from sently v1.2.2 (src/webhooks)
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors

import type { DeliveryEvent } from '../../index.js';

/**
 * A request as a webhook receives it: its raw body, before any parsing, as
 * a signature covers its bytes, and its header fields, a fetch `Headers` or
 * the `headers` of a Node request.
 */
export interface WebhookRequest {
  readonly body: string | Uint8Array;
  readonly headers?: Headers | Readonly<Record<string, string | readonly string[] | undefined>>;
}

/**
 * Why a request was refused.
 */
export type WebhookVerificationReason =
  | 'signature'
  | 'timestamp'
  | 'replay'
  | 'payload'
  | 'certificate'
  | 'topic'
  | 'credentials';

/**
 * A request a verifier refused.  Answer `replay` with a 2xx: the provider
 * delivered it before.
 */
export declare class WebhookVerificationError extends Error {
  readonly reason: WebhookVerificationReason;
  constructor(reason: WebhookVerificationReason, message: string, options?: ErrorOptions);
}

/**
 * Where the ids of the requests already taken are kept, for `ttlMs`.
 */
export interface ReplayStore {
  /** Keeps an id: true when it is new, false when it was seen before. */
  add(id: string, ttlMs: number): boolean | Promise<boolean>;
}

/**
 * The options of {@link createMemoryReplayStore}.
 */
export interface MemoryReplayStoreOptions {
  /**
   * The most ids kept, the oldest dropped first.
   * @default 10000
   */
  readonly maxEntries?: number;
  /** The clock, in milliseconds. */
  readonly now?: () => number;
}

/**
 * Makes a store of the ids of the requests already taken, in this process.
 *
 * @throws {TypeError} If an option is invalid.
 */
export declare function createMemoryReplayStore(options?: MemoryReplayStoreOptions): ReplayStore;

/**
 * The options every verifier takes.
 */
export interface WebhookVerifierOptions {
  /** The clock, in milliseconds. */
  readonly now?: () => number;
  /** How far from now a request may be signed, in milliseconds. */
  readonly toleranceMs?: number;
  /**
   * The ids already taken; an in-process store by default, `null` for none.
   */
  readonly replayStore?: ReplayStore | null;
  /**
   * The longest body taken, in bytes.
   * @default 5242880
   */
  readonly maxBodyBytes?: number;
}

/**
 * What a verifier reads from a request: its events, one per message and
 * recipient.
 */
export interface WebhookResult<TProviderId extends string = string> {
  readonly events: readonly DeliveryEvent<TProviderId>[];
}

/**
 * A verifier of the requests of one provider's webhook.
 */
export interface WebhookVerifier<TResult> {
  /**
   * Verifies a request and reads its events.
   *
   * @throws {WebhookVerificationError} If the request is refused.
   * @throws {TypeError} If the body is not raw.
   */
  verify(request: WebhookRequest): Promise<TResult>;
}

/**
 * The options of {@link createSesWebhookVerifier}.
 */
export interface SesWebhookVerifierOptions extends WebhookVerifierOptions {
  /** The SNS topics taken; a message of another is refused. */
  readonly topicArns: readonly string[];
  /** The fetch the signing certificates are read with. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * How far from now an SNS message may have been published, as SNS
   * retries it with its first time.
   * @default 3600000
   */
  readonly toleranceMs?: number;
}

/**
 * An SNS subscription message, verified, which the application confirms by
 * fetching `subscribeUrl` when it wants the subscription.
 */
export interface SnsConfirmation {
  readonly type: 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';
  readonly topicArn: string;
  readonly subscribeUrl: string;
  readonly token: string;
  readonly message: string;
}

/**
 * What the SES verifier reads: the events of a notification, or the
 * confirmation of a subscription.
 */
export interface SesWebhookResult extends WebhookResult<'ses'> {
  readonly confirmation?: SnsConfirmation;
}

/**
 * Makes the verifier of the SNS messages of Amazon SES.  A message is taken
 * when its topic is listed, its signature (version 1 or 2) matches the
 * certificate of its `sns.<region>.amazonaws.com` URL, it was published within
 * `toleranceMs`, and its id was not taken before.  A bounce says whether it
 * is hard (Permanent) or soft (Transient); the `category` tags are the tags
 * of the message, the other tags of the application its metadata.
 *
 * @throws {TypeError} If an option is invalid.
 */
export declare function createSesWebhookVerifier(
  options: SesWebhookVerifierOptions,
): WebhookVerifier<SesWebhookResult>;
