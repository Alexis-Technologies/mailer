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
 * The options of {@link BrevoTransport}.
 */
export interface BrevoConfig extends TransportDependencies {
  /** A transactional API key (`xkeysib-…`). */
  readonly apiKey: string;
  /**
   * The base URL of the API, https (or http to this machine).
   * @default "https://api.brevo.com"
   */
  readonly baseUrl?: string;
  /**
   * Brevo's sandbox: each request is checked in full and then dropped,
   * nothing delivered (`X-Sib-Sandbox: drop`).
   * @default false
   */
  readonly sandbox?: boolean;
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
   * Retries of a request; with its idempotency key, one whose delivery is
   * unknown is retried too.
   * @default 3
   */
  readonly retries?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A transport over the transactional email API of Brevo.  Every request
 * carries an idempotency key, the message's or a generated one, as the UUID
 * Brevo takes; `scheduledAt` schedules the message, `tags` are Brevo's tags
 * and `metadata` goes in `X-Mailin-custom`.  A second reply-to address and an
 * inline attachment, which Brevo cannot take, are refused.
 *
 * @example
 * ```js
 * const { BrevoTransport } = require('@alexify/mailer/brevo');
 * const transport = new BrevoTransport({ apiKey: process.env.BREVO_API_KEY });
 * ```
 */
export declare class BrevoTransport implements VerifiableTransport<'brevo'> {
  readonly id = 'brevo';
  constructor(config: BrevoConfig);
  send(message: Message, options?: TransportOptions): Promise<Receipt<'brevo'>>;
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'brevo'>>;
  /** Verifies the API key by reading its account (`GET /v3/account`). */
  verify(options?: TransportOptions): Promise<void>;
}
