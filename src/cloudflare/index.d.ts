// Types ported from unemail v0.7.0 (src/drivers)
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

import type {
  Message,
  RawMessage,
  RawTransport,
  Receipt,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

/**
 * The options of {@link CloudflareTransport}.
 */
export interface CloudflareConfig extends TransportDependencies {
  /** The id of the Cloudflare account. */
  readonly accountId: string;
  /** An API token with the permission to send email. */
  readonly apiToken: string;
  /**
   * The base URL of the API, https (or http to this machine).
   * @default "https://api.cloudflare.com/client/v4"
   */
  readonly baseUrl?: string;
  /**
   * The most requests of `sendMany()` at once.
   * @default 5
   */
  readonly concurrency?: number;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request that failed before Cloudflare took it.
   * @default 3
   */
  readonly retries?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * The receipt of {@link CloudflareTransport}: a successful one lists the
 * recipients that bounced permanently or were dropped as suppressed, while
 * the others received the message or have it queued.
 */
export type CloudflareReceipt =
  | (Extract<Receipt<'cloudflare'>, { readonly successful: true }> & {
      /** The recipients that bounced permanently, when there are any. */
      readonly bouncedRecipients?: readonly string[];
      /** The recipients dropped as on the suppression list, when there are any. */
      readonly suppressedRecipients?: readonly string[];
    })
  | Extract<Receipt<'cloudflare'>, { readonly successful: false }>;

/**
 * A transport over the Email Service API of Cloudflare, from any runtime with
 * `fetch` (in a Worker, its binding needs no token).  `metadata` goes in
 * `X-Metadata-<key>` headers; Cloudflare has no tags, per-message tracking
 * or scheduling; a ready MIME message goes through `send_raw`.
 *
 * @example
 * ```js
 * const { CloudflareTransport } = require('@alexify/mailer/cloudflare');
 * const transport = new CloudflareTransport({
 *   accountId: process.env.CF_ACCOUNT_ID,
 *   apiToken: process.env.CF_API_TOKEN,
 * });
 * ```
 */
export declare class CloudflareTransport
  implements RawTransport<'cloudflare'>, VerifiableTransport<'cloudflare'>
{
  readonly id = 'cloudflare';
  constructor(config: CloudflareConfig);
  send(message: Message, options?: TransportOptions): Promise<CloudflareReceipt>;
  /** Sends a ready MIME message, whose bytes must be UTF-8. */
  sendRaw(message: RawMessage, options?: TransportOptions): Promise<CloudflareReceipt>;
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<CloudflareReceipt>;
  /** Verifies the API token with Cloudflare's own check. */
  verify(options?: TransportOptions): Promise<void>;
}
