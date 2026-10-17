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
 * The options of {@link PostmarkTransport}.
 */
export interface PostmarkConfig extends TransportDependencies {
  /** The Server API token, not the account token. */
  readonly serverToken: string;
  /**
   * The base URL of the API, https (or http to this machine).
   * @default "https://api.postmarkapp.com"
   */
  readonly baseUrl?: string;
  /**
   * The message stream, such as `broadcast` for bulk mail; Postmark's default
   * transactional stream when it is not set.
   */
  readonly messageStream?: string;
  /** Open tracking, unless a message sets its own `tracking`. */
  readonly openTracking?: boolean;
  /** Link tracking (HTML and text), unless a message sets its own. */
  readonly clickTracking?: boolean;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request that failed before Postmark took it.
   * @default 3
   */
  readonly retries?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A transport over the API of Postmark.  A message goes to `/email`, a batch
 * of up to 500 to `/email/batch`, each with the receipt of its own answer.
 * The first tag is Postmark's `Tag` (a second is refused), `metadata` its
 * `Metadata`, an inline part a `cid:` ContentID.  Postmark cannot schedule a
 * message, and has no idempotency key.
 *
 * @example
 * ```js
 * const { PostmarkTransport } = require('@alexify/mailer/postmark');
 * const transport = new PostmarkTransport({ serverToken: process.env.POSTMARK_TOKEN });
 * ```
 */
export declare class PostmarkTransport implements VerifiableTransport<'postmark'> {
  readonly id = 'postmark';
  constructor(config: PostmarkConfig);
  send(message: Message, options?: TransportOptions): Promise<Receipt<'postmark'>>;
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'postmark'>>;
  /** Verifies the server token by reading its server (`GET /server`). */
  verify(options?: TransportOptions): Promise<void>;
}
