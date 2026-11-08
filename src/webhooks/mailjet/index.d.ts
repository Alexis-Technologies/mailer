// Not ported: the types of ./webhooks/mailjet, the verifier of the events of
// Mailjet's Event API.

import type { BasicWebhookVerifierOptions, WebhookResult, WebhookVerifier } from '../index.js';

/**
 * Makes the verifier of Mailjet's Event API, whose callback URL carries Basic
 * credentials, as Mailjet signs nothing.  The message id is the MessageUUID
 * of the receipt; the custom campaign is the tag, the event payload the
 * metadata.
 *
 * @throws {TypeError} If a credential is missing.
 */
export declare function createMailjetWebhookVerifier(
  options: BasicWebhookVerifierOptions,
): WebhookVerifier<WebhookResult<'mailjet'>>;
