// Not ported: the types of ./webhooks/sparkpost, the verifier of the events of
// SparkPost's webhooks.

import type { BasicWebhookVerifierOptions, WebhookResult, WebhookVerifier } from '../index.js';

/**
 * Makes the verifier of SparkPost's webhooks, configured with Basic
 * authentication, as SparkPost signs nothing.  The message id is that of the
 * transmission, the receipt's; the tags and metadata are the recipient's.
 *
 * @throws {TypeError} If a credential is missing.
 */
export declare function createSparkPostWebhookVerifier(
  options: BasicWebhookVerifierOptions,
): WebhookVerifier<WebhookResult<'sparkpost'>>;
