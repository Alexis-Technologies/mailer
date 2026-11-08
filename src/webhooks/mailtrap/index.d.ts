// Not ported: the types of ./webhooks/mailtrap, the verifier of the events of
// Mailtrap's sending webhooks.

import type { SignedBodyWebhookVerifierOptions, WebhookResult, WebhookVerifier } from '../index.js';

/**
 * Makes the verifier of Mailtrap's sending webhooks: the HMAC-SHA256 of the
 * body, in hexadecimal in `Mailtrap-Signature`; a body of JSON or JSON Lines.
 * The category and the `tag_` variables are the tags, the other custom
 * variables the metadata, as `./mailtrap` sends them.
 *
 * @throws {TypeError} If the secret is missing.
 */
export declare function createMailtrapWebhookVerifier(
  options: SignedBodyWebhookVerifierOptions,
): WebhookVerifier<WebhookResult<'mailtrap'>>;
