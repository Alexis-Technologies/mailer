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
 * The options of {@link MailerSendTransport}.
 */
export interface MailerSendConfig extends TransportDependencies {
  /** An API token. */
  readonly apiKey: string;
  /**
   * The base URL of the API, https (or http to this machine).
   * @default "https://api.mailersend.com"
   */
  readonly baseUrl?: string;
  /** Open tracking, unless a message sets its own `tracking`. */
  readonly openTracking?: boolean;
  /** Click tracking, unless a message sets its own. */
  readonly clickTracking?: boolean;
  /** Marks every message as bulk (`precedence_bulk`). */
  readonly precedenceBulk?: boolean;
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
   * Retries of a request that failed before MailerSend took it.
   * @default 3
   */
  readonly retries?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The clock, in milliseconds, for the 72 hours of `scheduledAt`. */
  readonly now?: () => number;
}

/**
 * A transport over the email API of MailerSend.  `scheduledAt` (at most 72
 * hours ahead) is `send_at`, `tags` (up to 5) its tags, `metadata` goes in
 * `X-Metadata-<key>` headers, `tracking` in its settings; the threading
 * fields and List-Unsubscribe go in the fields MailerSend has for them.
 *
 * @example
 * ```js
 * const { MailerSendTransport } = require('@alexify/mailer/mailersend');
 * const transport = new MailerSendTransport({ apiKey: process.env.MAILERSEND_API_KEY });
 * ```
 */
export declare class MailerSendTransport implements VerifiableTransport<'mailersend'> {
  readonly id = 'mailersend';
  constructor(config: MailerSendConfig);
  send(message: Message, options?: TransportOptions): Promise<Receipt<'mailersend'>>;
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'mailersend'>>;
  /** Verifies the API token by reading the domains of the account. */
  verify(options?: TransportOptions): Promise<void>;
}
