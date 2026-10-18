// Types ported from unemail v0.7.0 (src/drivers)
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

import type {
  Message,
  Receipt,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

interface AzureOptions extends TransportDependencies {
  /**
   * The version of the Email API.
   * @default "2025-09-01"
   */
  readonly apiVersion?: string;
  /**
   * Turns open and click tracking off for every message, unless a message
   * sets its own `tracking`; it cannot turn on what the resource has off.
   */
  readonly userEngagementTrackingDisabled?: boolean;
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
   * Retries of a request; a repeat within five minutes is answered with the
   * outcome of the first.
   * @default 3
   */
  readonly retries?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The clock, in milliseconds, of the signatures and of the repeats. */
  readonly now?: () => number;
}

/**
 * The options of {@link AzureTransport}: the connection string of the
 * resource, or its endpoint and access key.
 */
export type AzureConfig = AzureOptions &
  (
    | {
        /**
         * `endpoint=https://….communication.azure.com/;accesskey=…`, as the
         * Keys of the resource show it.
         */
        readonly connectionString: string;
        readonly endpoint?: never;
        readonly accessKey?: never;
      }
    | {
        readonly connectionString?: never;
        /**
         * The endpoint of the resource, HTTPS (or HTTP to this machine), such
         * as `https://my-resource.communication.azure.com`.
         */
        readonly endpoint: string;
        /** The base64 access key of the resource. */
        readonly accessKey: string;
      }
  );

/**
 * A transport over the Email API of Azure Communication Services, signed
 * with the access key (HMAC-SHA256).  The sender goes as its address alone,
 * its display name that of the sender in the resource; `metadata` goes in
 * `X-Metadata-<key>` headers; `tracking` turns both kinds on or off; Azure
 * has no tags and cannot schedule a message.
 *
 * @example
 * ```js
 * const { AzureTransport } = require('@alexify/mailer/azure');
 * const transport = new AzureTransport({
 *   connectionString: process.env.ACS_CONNECTION_STRING,
 * });
 * ```
 */
export declare class AzureTransport implements VerifiableTransport<'azure'> {
  readonly id = 'azure';
  constructor(config: AzureConfig);
  send(message: Message, options?: TransportOptions): Promise<Receipt<'azure'>>;
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'azure'>>;
  /** Verifies the access key with a signed read of the API. */
  verify(options?: TransportOptions): Promise<void>;
}
