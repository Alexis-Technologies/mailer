// Types ported from sently v1.2.2 (src/webhooks/sendgrid.ts)
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors

import type { WebhookResult, WebhookVerifier, WebhookVerifierOptions } from '../index.js';

/**
 * The options of {@link createSendGridWebhookVerifier}.
 */
export interface SendGridWebhookVerifierOptions extends WebhookVerifierOptions {
  /**
   * The verification key of the Signed Event Webhook, base64 as SendGrid
   * shows it, or PEM.
   */
  readonly publicKey: string;
}

/**
 * Makes the verifier of SendGrid's Signed Event Webhook: ECDSA P-256 over
 * the timestamp and the body, within five minutes, each event id taken once.
 * The categories are the tags of the message, its custom arguments its
 * metadata.
 *
 * @throws {TypeError} If the key is not one.
 */
export declare function createSendGridWebhookVerifier(
  options: SendGridWebhookVerifierOptions,
): WebhookVerifier<WebhookResult<'sendgrid'>>;
