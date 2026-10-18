// Types ported from sently v1.2.2 (src/transports)
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors

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
 * The options of {@link SparkPostTransport}.
 */
export interface SparkPostConfig extends TransportDependencies {
  /** An API key with the Transmissions permission. */
  readonly apiKey: string;
  /**
   * The region of the account, which chooses the host of the API.
   * @default "us"
   */
  readonly region?: 'us' | 'eu';
  /**
   * The base URL of the API, https (or http to this machine), in place of the
   * host of the region.
   */
  readonly baseUrl?: string;
  /** The campaign of every transmission (`campaign_id`). */
  readonly campaignId?: string;
  /** Marks every transmission as transactional, or not. */
  readonly transactional?: boolean;
  /** Open tracking, unless a message sets its own `tracking`. */
  readonly openTracking?: boolean;
  /** Click tracking, unless a message sets its own. */
  readonly clickTracking?: boolean;
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
   * Retries of a request that failed before SparkPost took it.
   * @default 3
   */
  readonly retries?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * The receipt of {@link SparkPostTransport}: a successful one counts the
 * recipients SparkPost turned away, such as those on its suppression list.
 */
export type SparkPostReceipt =
  | (Extract<Receipt<'sparkpost'>, { readonly successful: true }> & {
      /** The recipients SparkPost turned away, when there are any. */
      readonly rejectedRecipientCount?: number;
    })
  | Extract<Receipt<'sparkpost'>, { readonly successful: false }>;

/**
 * A transport over the Transmissions API of SparkPost.  Cc and Bcc
 * recipients see the To field of the message, and the Cc ones its Cc field;
 * `scheduledAt` is `start_time`, `tags` the tags of each recipient (up to
 * 10), `metadata` that of the transmission, `tracking` its options; a ready
 * MIME message goes as `email_rfc822`.
 *
 * @example
 * ```js
 * const { SparkPostTransport } = require('@alexify/mailer/sparkpost');
 * const transport = new SparkPostTransport({
 *   apiKey: process.env.SPARKPOST_API_KEY,
 *   region: 'eu',
 * });
 * ```
 */
export declare class SparkPostTransport
  implements RawTransport<'sparkpost'>, VerifiableTransport<'sparkpost'>
{
  readonly id = 'sparkpost';
  constructor(config: SparkPostConfig);
  send(message: Message, options?: TransportOptions): Promise<SparkPostReceipt>;
  /** Sends a ready MIME message, whose bytes must be UTF-8. */
  sendRaw(message: RawMessage, options?: TransportOptions): Promise<SparkPostReceipt>;
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<SparkPostReceipt>;
  /** Verifies the API key by reading the account. */
  verify(options?: TransportOptions): Promise<void>;
}
