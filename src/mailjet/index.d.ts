// Types ported from unemail v0.7.0 (src/drivers)
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

import type {
  Message,
  Receipt,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

/**
 * The options of {@link MailjetTransport}.
 */
export interface MailjetConfig extends TransportDependencies {
  /** The API key, `MJ_APIKEY_PUBLIC`. */
  readonly apiKey: string;
  /** The secret key, `MJ_APIKEY_PRIVATE`. */
  readonly apiSecret: string;
  /**
   * The base URL of the API, https (or http to this machine).
   * @default "https://api.mailjet.com"
   */
  readonly baseUrl?: string;
  /**
   * Mailjet's sandbox: each message is checked and dropped, nothing
   * delivered (`SandboxMode`).
   * @default false
   */
  readonly sandbox?: boolean;
  /** Open tracking of an HTML message, unless it sets its own `tracking`. */
  readonly openTracking?: boolean;
  /** Click tracking of an HTML message, unless it sets its own. */
  readonly clickTracking?: boolean;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request that failed before Mailjet took it.
   * @default 3
   */
  readonly retries?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A transport over the Send API v3.1 of Mailjet.  A batch goes in requests of
 * up to 50 recipients, each message with the receipt of its own answer.  The
 * first tag is the `CustomCampaign` (a second is refused), `metadata` the
 * `EventPayload`; the fields Mailjet sets itself (`List-Id`, `Message-ID`, …)
 * are refused, and so is a scheduled message.
 *
 * @example
 * ```js
 * const { MailjetTransport } = require('@alexify/mailer/mailjet');
 * const transport = new MailjetTransport({
 *   apiKey: process.env.MJ_APIKEY_PUBLIC,
 *   apiSecret: process.env.MJ_APIKEY_PRIVATE,
 * });
 * ```
 */
export declare class MailjetTransport implements VerifiableTransport<'mailjet'> {
  readonly id = 'mailjet';
  constructor(config: MailjetConfig);
  send(message: Message, options?: TransportOptions): Promise<Receipt<'mailjet'>>;
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'mailjet'>>;
  /** Verifies the key pair by reading its profile (`GET /v3/REST/myprofile`). */
  verify(options?: TransportOptions): Promise<void>;
}
