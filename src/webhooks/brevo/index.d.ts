// Types ported from sently v1.2.2 (src/webhooks/brevo.ts)
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors

import type { WebhookResult, WebhookVerifier, WebhookVerifyListener } from '../index.js';

/**
 * The options of {@link createBrevoWebhookVerifier}.
 */
export interface BrevoWebhookVerifierOptions {
  /** Hears each request taken or refused. */
  readonly onVerify?: WebhookVerifyListener;
  /** The token the webhook is configured with. */
  readonly token: string;
  /**
   * The header field that carries it: `authorization`, as `Bearer <token>`
   * for the `auth` token of the webhook, or a custom header with the token
   * as its value.
   * @default "authorization"
   */
  readonly header?: string;
  /**
   * The longest body taken, in bytes.
   * @default 5242880
   */
  readonly maxBodyBytes?: number;
}

/**
 * Makes the verifier of Brevo's transactional webhooks, which carry the token
 * they are configured with, as Brevo signs nothing; compared in constant
 * time.  The metadata is read from `X-Mailin-custom`, as `./brevo` sends it.
 *
 * @throws {TypeError} If the token is missing.
 */
export declare function createBrevoWebhookVerifier(
  options: BrevoWebhookVerifierOptions,
): WebhookVerifier<WebhookResult<'brevo'>>;
