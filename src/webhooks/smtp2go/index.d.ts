// Not ported: the types of ./webhooks/smtp2go, the verifier of the events of
// SMTP2GO's webhooks.

import type { BasicWebhookVerifierOptions, WebhookResult, WebhookVerifier } from '../index.js';

/**
 * Makes the verifier of SMTP2GO's webhooks, whose URL carries Basic
 * credentials, as SMTP2GO signs nothing; a body of JSON or of a form.
 *
 * @throws {TypeError} If a credential is missing.
 */
export declare function createSmtp2goWebhookVerifier(
  options: BasicWebhookVerifierOptions,
): WebhookVerifier<WebhookResult<'smtp2go'>>;
