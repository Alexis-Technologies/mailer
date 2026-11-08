// Not ported: the types of ./webhooks/azure, the verifier of the events of
// Azure Communication Services, delivered by Event Grid.

import type {
  ReplayStore,
  WebhookResult,
  WebhookVerifier,
  WebhookVerifierOptions,
  WebhookVerifyListener,
} from '../index.js';

/**
 * The options of {@link createAzureWebhookVerifier}.
 */
export interface AzureWebhookVerifierOptions {
  /** Hears each request taken or refused. */
  readonly onVerify?: WebhookVerifyListener;
  /** The token the Event Grid subscription sends as a secret delivery property. */
  readonly token: string;
  /**
   * The header field of the token: `authorization`, as `Bearer <token>`, or a
   * custom one with the token as its value.
   * @default "authorization"
   */
  readonly header?: string;
  /** The ids taken, as {@link WebhookVerifierOptions.replayStore}. */
  readonly replayStore: ReplayStore | null;
  /**
   * How long an id stays reserved while its request is handled.
   * @default 30000
   */
  readonly leaseMs?: number;
  /**
   * The longest body taken, in bytes.
   * @default 5242880
   */
  readonly maxBodyBytes?: number;
}

/**
 * The validation of a new Event Grid subscription, which the application
 * answers with `{ validationResponse: validationCode }`, or confirms by
 * fetching `validationUrl`, which is on `*.eventgrid.azure.net` over HTTPS
 * (another is refused).  The token is checked when the validation carries it.
 */
export interface EventGridValidation {
  readonly validationCode: string;
  readonly validationUrl?: string;
}

/**
 * What the Azure verifier reads: the events of a notification, or the
 * validation of a subscription.
 */
export interface AzureWebhookResult extends WebhookResult<'azure'> {
  readonly validation?: EventGridValidation;
}

/**
 * Makes the verifier of the email events of Azure Communication Services,
 * delivered by Event Grid in its own schema: the delivery reports and the
 * engagement reports.  Event Grid signs nothing, so every notification must
 * carry the token of the subscription; each event is taken once by its id.
 *
 * @throws {TypeError} If the token is missing.
 */
export declare function createAzureWebhookVerifier(
  options: AzureWebhookVerifierOptions,
): WebhookVerifier<AzureWebhookResult>;
