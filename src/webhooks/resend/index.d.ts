// Types ported from sently v1.2.2 (src/webhooks/resend.ts)
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors

import type { WebhookResult, WebhookVerifier, WebhookVerifierOptions } from '../index.js';

/**
 * The options of {@link createResendWebhookVerifier}.
 */
export interface ResendWebhookVerifierOptions extends WebhookVerifierOptions {
  /** The signing secret of the webhook, `whsec_…`. */
  readonly secret: string;
}

/**
 * Makes the verifier of the webhooks of Resend, which Svix signs: the
 * HMAC-SHA256 of `svix-id.svix-timestamp.body`, within five minutes, its id
 * taken once.  `tag1`, `tag2`… of the email's tags are the tags of the
 * message, the others its metadata, as `./resend` sends them.
 *
 * @throws {TypeError} If the secret is not one.
 */
export declare function createResendWebhookVerifier(
  options: ResendWebhookVerifierOptions,
): WebhookVerifier<WebhookResult<'resend'>>;
