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
 * The options of {@link ScalewayTransport}.
 */
export interface ScalewayConfig extends TransportDependencies {
  /** The secret key of a Scaleway API key, sent as `X-Auth-Token`. */
  readonly secretKey: string;
  /** The project the emails are made in. */
  readonly projectId: string;
  /**
   * The region of Transactional Email.
   * @default "fr-par"
   */
  readonly region?: string;
  /**
   * The base URL of the API, https (or http to this machine).
   * @default "https://api.scaleway.com"
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
   * Retries of a request that failed before Scaleway took it.
   * @default 3
   */
  readonly retries?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A transport over the Transactional Email API of Scaleway.  The reply-to
 * addresses and `metadata` (`X-Metadata-<key>`) go in header fields; Scaleway
 * has no tags, per-message tracking, scheduling or inline attachments, and
 * takes a request of at most 2 MB.
 *
 * @example
 * ```js
 * const { ScalewayTransport } = require('@alexify/mailer/scaleway');
 * const transport = new ScalewayTransport({
 *   secretKey: process.env.SCW_SECRET_KEY,
 *   projectId: process.env.SCW_DEFAULT_PROJECT_ID,
 * });
 * ```
 */
export declare class ScalewayTransport implements VerifiableTransport<'scaleway'> {
  readonly id = 'scaleway';
  constructor(config: ScalewayConfig);
  send(message: Message, options?: TransportOptions): Promise<Receipt<'scaleway'>>;
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'scaleway'>>;
  /** Verifies the secret key by listing the domains of the project. */
  verify(options?: TransportOptions): Promise<void>;
}
