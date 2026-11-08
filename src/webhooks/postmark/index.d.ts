// Types ported from sently v1.2.2 (src/webhooks/postmark.ts)
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors

import type { BasicWebhookVerifierOptions, WebhookResult, WebhookVerifier } from '../index.js';

/**
 * Makes the verifier of Postmark's webhooks, whose URL carries Basic
 * credentials (`https://user:password@…`), compared in constant time.
 * Postmark signs no time or id, so nothing holds a request to a window or
 * takes it once.  A bounce is read by its type.
 *
 * @throws {TypeError} If a credential is missing.
 */
export declare function createPostmarkWebhookVerifier(
  options: BasicWebhookVerifierOptions,
): WebhookVerifier<WebhookResult<'postmark'>>;
