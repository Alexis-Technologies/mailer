// Types ported from sently v1.2.2 (src/webhooks/mailgun.ts)
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors

import type { WebhookResult, WebhookVerifier, WebhookVerifierOptions } from '../index.js';

/**
 * The options of {@link createMailgunWebhookVerifier}.
 */
export interface MailgunWebhookVerifierOptions extends WebhookVerifierOptions {
  /** The HTTP webhook signing key of the Mailgun domain. */
  readonly signingKey: string;
}

/**
 * Makes the verifier of Mailgun's webhooks: the HMAC-SHA256 of the
 * timestamp and token of the body, within five minutes, the token taken
 * once.  A permanent failure is a hard bounce, a temporary one a deferred
 * soft bounce, a suppression `rejected`; the user variables are the
 * metadata.
 *
 * @throws {TypeError} If the key is missing.
 */
export declare function createMailgunWebhookVerifier(
  options: MailgunWebhookVerifierOptions,
): WebhookVerifier<WebhookResult<'mailgun'>>;
