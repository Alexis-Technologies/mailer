// Not ported: the types of ./webhooks/scaleway, the verifier of the events of
// Scaleway Transactional Email, posted by its Topics and Events.

import type {
  SnsConfirmation,
  SnsWebhookVerifierOptions,
  WebhookResult,
  WebhookVerifier,
} from '../index.js';

/**
 * The options of {@link createScalewayWebhookVerifier}.
 */
export interface ScalewayWebhookVerifierOptions extends SnsWebhookVerifierOptions {
  /** The topics of Topics and Events taken; a message of another is refused. */
  readonly topicArns: readonly string[];
  /**
   * The PEM of Scaleway's SNS trust chain, which issued the certificate a
   * message is signed with: each certificate of it a CA, or the verifier is
   * not made, and one valid when it is trusted.
   */
  readonly trustChain: string;
  /**
   * How far from now a message may have been published.
   * @default 3600000
   */
  readonly toleranceMs?: number;
}

/**
 * What the Scaleway verifier reads: the events of a notification, or the
 * confirmation of a subscription.
 */
export interface ScalewayWebhookResult extends WebhookResult<'scaleway'> {
  readonly confirmation?: SnsConfirmation;
}

/**
 * Makes the verifier of the events of Scaleway Transactional Email, which
 * Topics and Events posts as SNS messages: from a listed topic, signed with a
 * certificate on a Scaleway host that the pinned trust chain issued, within an
 * hour, taken once.  The metadata comes back from the `X-Metadata-<key>`
 * fields of the email, as `./scaleway` sends it.
 *
 * @throws {TypeError} If an option is invalid.
 */
export declare function createScalewayWebhookVerifier(
  options: ScalewayWebhookVerifierOptions,
): WebhookVerifier<ScalewayWebhookResult>;
