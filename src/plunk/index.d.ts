// Types ported from upyo v0.7.0 (packages/plunk/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

import type {
  Message,
  Receipt,
  Transport,
  TransportDependencies,
  TransportOptions,
} from '../../index.js';

/**
 * Configuration interface for Plunk transport connection settings.
 *
 * This interface defines all available options for configuring a Plunk
 * API connection including authentication, HTTP options, and base URL for
 * self-hosted instances.
 *
 * @example
 * ```typescript
 * const config: PlunkConfig = {
 *   apiKey: 'your-api-key',
 *   baseUrl: 'https://next-api.useplunk.com', // or self-hosted URL
 *   timeout: 30000,
 *   retries: 3
 * };
 * ```
 */
export interface PlunkConfig extends TransportDependencies {
  /**
   * Your Plunk API key.
   *
   * You can find your API key in your Plunk dashboard under Settings > API Keys.
   * The key will be used as a Bearer token for authentication.
   */
  readonly apiKey: string;
  /**
   * Base URL for the Plunk API.
   *
   * For Plunk's hosted service, use "https://next-api.useplunk.com" (default).
   * For self-hosted instances, use your domain with "/api" path
   * (e.g., "https://plunk.example.com/api").
   *
   * @default "https://next-api.useplunk.com"
   */
  readonly baseUrl?: string;
  /**
   * HTTP request timeout in milliseconds, response body included; 0 or
   * `Infinity` for none.
   *
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Number of retry attempts for failed requests.
   *
   * @default 3
   */
  readonly retries?: number;
  /**
   * How many messages `sendMany()` sends at once.  It reads a message only
   * when a send can start and gives the receipts in the order of the
   * messages; 1 sends one after the other.
   *
   * @default 1
   */
  readonly concurrency?: number;
  /**
   * Must be true or left out: fetch checks every certificate, and `false`
   * throws a `TypeError`.  For a test server with a self-signed certificate,
   * pass a `fetch` whose undici dispatcher skips the check.
   *
   * @default true
   */
  readonly validateSsl?: boolean;
  /**
   * Additional HTTP headers to include with requests.
   */
  readonly headers?: Record<string, string>;
}
/**
 * Resolved Plunk configuration with all optional fields filled with default values.
 *
 * This type represents the final configuration after applying defaults,
 * used internally by the Plunk transport implementation.
 */
export type ResolvedPlunkConfig = Required<Omit<PlunkConfig, keyof TransportDependencies>> &
  TransportDependencies;
/**
 * Creates a resolved Plunk configuration by applying default values to optional fields.
 *
 * This function takes a partial Plunk configuration and returns a complete
 * configuration with all optional fields filled with sensible defaults.
 * It is used internally by the Plunk transport.
 *
 * @param config - The Plunk configuration with optional fields
 * @returns A resolved configuration with all defaults applied
 * @internal
 */

/**
 * Plunk transport implementation for sending emails via Plunk API.
 *
 * This transport provides efficient email delivery using Plunk's HTTP API,
 * with support for both cloud-hosted and self-hosted instances, authentication,
 * retry logic, and batch sending capabilities.
 *
 * @example
 * ```typescript
 * import { PlunkTransport } from '@alexify/mailer/plunk';
 *
 * const transport = new PlunkTransport({
 *   apiKey: 'your-plunk-api-key',
 *   baseUrl: 'https://next-api.useplunk.com', // or self-hosted URL
 *   timeout: 30000,
 *   retries: 3
 * });
 *
 * const receipt = await transport.send(message);
 * if (receipt.successful) {
 *   console.log('Message sent with ID:', receipt.messageId);
 * } else {
 *   console.error('Send failed:', receipt.errorMessages.join(', '));
 * }
 * ```
 */
export declare class PlunkTransport implements Transport<'plunk'> {
  readonly id = 'plunk';
  /**
   * The resolved Plunk configuration used by this transport.
   */
  config: ResolvedPlunkConfig;
  /**
   * Creates a new Plunk transport instance.
   *
   * @param config Plunk configuration including API key and options.
   */
  constructor(config: PlunkConfig);
  /**
   * Sends a single email message via Plunk API.
   *
   * This method converts the message to Plunk format, makes an HTTP request
   * to the Plunk API, and returns a receipt with the result.
   *
   * @example
   * ```typescript
   * const receipt = await transport.send({
   *   sender: { address: 'from@example.com' },
   *   recipients: [{ address: 'to@example.com' }],
   *   ccRecipients: [],
   *   bccRecipients: [],
   *   replyRecipients: [],
   *   subject: 'Hello',
   *   content: { text: 'Hello World!' },
   *   attachments: [],
   *   priority: 'normal',
   *   tags: [],
   *   headers: new Headers()
   * });
   *
   * if (receipt.successful) {
   *   console.log('Message sent successfully');
   * }
   * ```
   *
   * @param message The email message to send.
   * @param options Optional transport options including `AbortSignal` for
   *                cancellation.
   * @returns A promise that resolves to a receipt indicating success or
   *          failure.
   */
  send(message: Message, options?: TransportOptions): Promise<Receipt<'plunk'>>;
  /**
   * Sends multiple email messages efficiently via Plunk API.
   *
   * This method sends each message individually but provides a streamlined
   * interface for processing multiple messages. Each message is sent as a
   * separate API request to Plunk.
   *
   * @example
   * ```typescript
   * const messages = [
   *   {
   *     sender: { address: 'from@example.com' },
   *     recipients: [{ address: 'user1@example.com' }],
   *     ccRecipients: [],
   *     bccRecipients: [],
   *     replyRecipients: [],
   *     subject: 'Message 1',
   *     content: { text: 'Hello User 1!' },
   *     attachments: [],
   *     priority: 'normal',
   *     tags: [],
   *     headers: new Headers()
   *   },
   *   {
   *     sender: { address: 'from@example.com' },
   *     recipients: [{ address: 'user2@example.com' }],
   *     ccRecipients: [],
   *     bccRecipients: [],
   *     replyRecipients: [],
   *     subject: 'Message 2',
   *     content: { text: 'Hello User 2!' },
   *     attachments: [],
   *     priority: 'normal',
   *     tags: [],
   *     headers: new Headers()
   *   }
   * ];
   *
   * for await (const receipt of transport.sendMany(messages)) {
   *   if (receipt.successful) {
   *     console.log('Sent:', receipt.messageId);
   *   } else {
   *     console.error('Failed:', receipt.errorMessages);
   *   }
   * }
   * ```
   *
   * @param messages An iterable or async iterable of messages to send.
   * @param options Optional transport options including `AbortSignal` for
   *                cancellation.
   * @returns An async iterable of receipts, one for each message.
   */
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'plunk'>>;
}

/**
 * Response from Plunk API for sending messages.
 */
export interface PlunkResponse {
  /**
   * Indicates whether the API call was successful.
   */
  readonly success: boolean;
  /**
   * Array of sent email details.
   */
  readonly emails: readonly {
    readonly contact: {
      readonly id: string;
      readonly email: string;
    };
    /**
     * Plunk email record ID used to correlate webhook events.
     */
    readonly email: string;
  }[];
  /**
   * Timestamp of the send operation.
   */
  readonly timestamp: string;
}
/**
 * Error response from Plunk API.
 */
export interface PlunkError {
  /**
   * Error message from Plunk.
   */
  readonly message: string;
  /**
   * HTTP status code.
   */
  readonly statusCode?: number;
  /**
   * Additional error details from Plunk API.
   */
  readonly details?: unknown;
}
/**
 * Error thrown when a Plunk API request fails.
 */
