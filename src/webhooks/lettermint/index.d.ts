// Not ported: the types of ./webhooks/lettermint, the verifier of the events of
// Lettermint's webhooks.

import type { WebhookResult, WebhookVerifier, WebhookVerifierOptions } from '../index.js';

/**
 * The options of {@link createLettermintWebhookVerifier}.
 */
export interface LettermintWebhookVerifierOptions extends WebhookVerifierOptions {
  /** The signing secret of the webhook, `whsec_…`, used as it is. */
  readonly secret: string;
}

/**
 * Makes the verifier of Lettermint's webhooks: the HMAC-SHA256 of the time
 * and body in `X-Lettermint-Signature` (`t=…,v1=…`), within five minutes, its
 * delivery id taken once.
 *
 * @throws {TypeError} If the secret is missing.
 */
export declare function createLettermintWebhookVerifier(
  options: LettermintWebhookVerifierOptions,
): WebhookVerifier<WebhookResult<'lettermint'>>;
