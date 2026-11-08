// Not ported: the types of ./webhooks/mailersend, the verifier of the events of
// MailerSend's webhooks.

import type { SignedBodyWebhookVerifierOptions, WebhookResult, WebhookVerifier } from '../index.js';

/**
 * Makes the verifier of MailerSend's webhooks: the HMAC-SHA256 of the body,
 * in hexadecimal in `Signature`.  The metadata is read from the
 * `X-Metadata-<key>` header fields of the email, when the event carries them.
 *
 * @throws {TypeError} If the secret is missing.
 */
export declare function createMailerSendWebhookVerifier(
  options: SignedBodyWebhookVerifierOptions,
): WebhookVerifier<WebhookResult<'mailersend'>>;
