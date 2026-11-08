// Types ported from sently v1.2.2 (src/webhooks/ses.ts)
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors

import type {
  SnsConfirmation,
  SnsWebhookVerifierOptions,
  WebhookResult,
  WebhookVerifier,
} from '../index.js';

/**
 * The options of {@link createSesWebhookVerifier}.
 */
export interface SesWebhookVerifierOptions extends SnsWebhookVerifierOptions {
  /**
   * How far from now an SNS message may have been published, as SNS
   * retries it with its first time.
   * @default 3600000
   */
  readonly toleranceMs?: number;
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
 * certificate of its `https://sns.<region>.amazonaws.com/SimpleNotificationService-….pem`
 * URL, it was published within `toleranceMs`, and its id was not taken
 * before.  A bounce says whether it
 * is hard (Permanent) or soft (Transient); the `category` tags are the tags
 * of the message, the other tags of the application its metadata.
 *
 * @throws {TypeError} If an option is invalid.
 */
export declare function createSesWebhookVerifier(
  options: SesWebhookVerifierOptions,
): WebhookVerifier<SesWebhookResult>;
