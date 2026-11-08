// Not ported: the types of ./webhooks/maileroo, the verifier of the events of
// Maileroo's webhooks.

import type { SignedBodyWebhookVerifierOptions, WebhookResult, WebhookVerifier } from '../index.js';

/**
 * Makes the verifier of Maileroo's webhooks: the HMAC-SHA256 of the body, in
 * hexadecimal in `x-maileroo-signature`, each event taken once.  The message
 * id is the reference of the message, the receipt's.
 *
 * @throws {TypeError} If the secret is missing.
 */
export declare function createMailerooWebhookVerifier(
  options: SignedBodyWebhookVerifierOptions,
): WebhookVerifier<WebhookResult<'maileroo'>>;
