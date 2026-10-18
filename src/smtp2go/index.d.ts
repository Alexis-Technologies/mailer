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
 * The options of {@link Smtp2goTransport}.
 */
export interface Smtp2goConfig extends TransportDependencies {
  /** An API key with the permission to send. */
  readonly apiKey: string;
  /**
   * The region of the account, whose host the requests go to; without one,
   * `api.smtp2go.com` routes them to the region nearest the resolver.
   */
  readonly region?: 'us' | 'eu' | 'au';
  /**
   * The base URL of the API, https (or http to this machine), in place of the
   * host of the region.
   */
  readonly baseUrl?: string;
  /**
   * Has SMTP2GO accept a message at once and send it in the background; the
   * answer then says nothing of a failure, which only the events tell.
   */
  readonly fastAccept?: boolean;
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
   * Retries of a request that failed before SMTP2GO took it.
   * @default 3
   */
  readonly retries?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The clock, in milliseconds, for the 3 days of `scheduledAt`. */
  readonly now?: () => number;
}

/**
 * A transport over the email API of SMTP2GO.  `scheduledAt` (at most 3 days
 * ahead) is `schedule`; the reply-to addresses and `metadata`
 * (`X-Metadata-<key>`) go in header fields; SMTP2GO has no tags, and tracking
 * is set on the API key, so neither is sent.
 *
 * @example
 * ```js
 * const { Smtp2goTransport } = require('@alexify/mailer/smtp2go');
 * const transport = new Smtp2goTransport({
 *   apiKey: process.env.SMTP2GO_API_KEY,
 *   region: 'eu',
 * });
 * ```
 */
export declare class Smtp2goTransport implements VerifiableTransport<'smtp2go'> {
  readonly id = 'smtp2go';
  constructor(config: Smtp2goConfig);
  send(message: Message, options?: TransportOptions): Promise<Receipt<'smtp2go'>>;
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'smtp2go'>>;
  /** Verifies the API key by reading the summary of the account. */
  verify(options?: TransportOptions): Promise<void>;
}
