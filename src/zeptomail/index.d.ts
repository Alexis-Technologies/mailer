// Types ported from unemail v0.7.0 (src/drivers)
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

import type {
  Message,
  Receipt,
  Transport,
  TransportDependencies,
  TransportOptions,
} from '../../index.js';

/**
 * The options of {@link ZeptoMailTransport}.
 */
export interface ZeptoMailConfig extends TransportDependencies {
  /**
   * The Send Mail token of a Mail Agent; `Zoho-enczapikey ` is added before
   * it unless it is there already.
   */
  readonly token: string;
  /**
   * The base URL of the API, https (or http to this machine); an account in
   * another data center uses that center's host, such as
   * `https://api.zeptomail.eu`.
   * @default "https://api.zeptomail.com"
   */
  readonly baseUrl?: string;
  /** The bounce address, on a bounce domain verified with ZeptoMail. */
  readonly bounceAddress?: string;
  /** The `client_reference` of a message without a tag. */
  readonly clientReference?: string;
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
   * Retries of a request that failed before ZeptoMail took it.
   * @default 3
   */
  readonly retries?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A transport over the email API of ZeptoMail (Zoho).  A message's one tag is
 * its `client_reference`, `metadata` goes in `X-Metadata-<key>` headers,
 * `tracking` in `track_opens` and `track_clicks`; ZeptoMail cannot schedule a
 * message.  It has no `verify()`: a Send Mail token can only send.
 *
 * @example
 * ```js
 * const { ZeptoMailTransport } = require('@alexify/mailer/zeptomail');
 * const transport = new ZeptoMailTransport({
 *   token: process.env.ZEPTOMAIL_TOKEN,
 *   bounceAddress: 'bounce@bounces.example.com',
 * });
 * ```
 */
export declare class ZeptoMailTransport implements Transport<'zeptomail'> {
  readonly id = 'zeptomail';
  constructor(config: ZeptoMailConfig);
  send(message: Message, options?: TransportOptions): Promise<Receipt<'zeptomail'>>;
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'zeptomail'>>;
}
