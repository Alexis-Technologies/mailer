// Types ported from upyo v0.7.0 (packages/mailgun/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

import type { Message, Receipt, Transport, TransportOptions } from '../../index.js';

/**
 * Configuration interface for Mailgun transport connection settings.
 *
 * This interface defines all available options for configuring a Mailgun
 * API connection including authentication, server region, and HTTP options.
 *
 * @example
 * ```typescript
 * const config: MailgunConfig = {
 *   apiKey: 'your-api-key',
 *   domain: 'your-domain.com',
 *   region: 'us', // or 'eu'
 *   timeout: 30000,
 *   retries: 3
 * };
 * ```
 */
export interface MailgunConfig {
  /**
   * Your Mailgun API key.
   *
   * You can find your API key in the Mailgun Control Panel.
   * It should start with 'key-' for private API keys.
   */
  readonly apiKey: string;
  /**
   * Your Mailgun domain.
   *
   * This is the domain you verified with Mailgun to send emails from.
   */
  readonly domain: string;
  /**
   * Mailgun region where your domain is hosted.
   *
   * @default "us"
   */
  readonly region?: 'us' | 'eu';
  /**
   * Base URL for the Mailgun API.
   *
   * If not provided, will be automatically determined based on the region.
   * - US region: https://api.mailgun.net/v3
   * - EU region: https://api.eu.mailgun.net/v3
   */
  readonly baseUrl?: string;
  /**
   * HTTP request timeout in milliseconds.
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
   * Whether to validate SSL certificates.
   *
   * @default true
   */
  readonly validateSsl?: boolean;
  /**
   * Additional HTTP headers to include with requests.
   */
  readonly headers?: Record<string, string>;
  /**
   * Whether to enable tracking for sent messages.
   *
   * @default true
   */
  readonly tracking?: boolean;
  /**
   * Whether to enable click tracking for sent messages.
   *
   * @default true
   */
  readonly clickTracking?: boolean;
  /**
   * Whether to enable open tracking for sent messages.
   *
   * @default true
   */
  readonly openTracking?: boolean;
}
/**
 * Resolved Mailgun configuration with all optional fields filled with default values.
 *
 * This type represents the final configuration after applying defaults,
 * used internally by the Mailgun transport implementation.
 */
type ResolvedMailgunConfig = Required<MailgunConfig>;
/**
 * Creates a resolved Mailgun configuration by applying default values to optional fields.
 *
 * This function takes a partial Mailgun configuration and returns a complete
 * configuration with all optional fields filled with sensible defaults.
 * It is used internally by the Mailgun transport.
 *
 * @param config - The Mailgun configuration with optional fields
 * @returns A resolved configuration with all defaults applied
 * @internal
 */

/**
 * Mailgun transport implementation for sending emails via Mailgun API.
 *
 * This transport provides efficient email delivery using Mailgun's HTTP API,
 * with support for authentication, retry logic, and batch sending capabilities.
 *
 * @example
 * ```typescript
 * import { MailgunTransport } from '@alexify/mailer/mailgun';
 *
 * const transport = new MailgunTransport({
 *   apiKey: 'your-api-key',
 *   domain: 'your-domain.com',
 *   region: 'us' // or 'eu'
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
export declare class MailgunTransport implements Transport<'mailgun'> {
  readonly id = 'mailgun';
  /**
   * The resolved Mailgun configuration used by this transport.
   */
  config: ResolvedMailgunConfig;
  /**
   * Creates a new Mailgun transport instance.
   *
   * @param config Mailgun configuration including API key, domain, and options.
   */
  constructor(config: MailgunConfig);
  /**
   * Sends a single email message via Mailgun API.
   *
   * This method converts the message to Mailgun format, makes an HTTP request
   * to the Mailgun API, and returns a receipt with the result.
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
   *   console.log('Message sent with ID:', receipt.messageId);
   * }
   * ```
   *
   * @param message The email message to send.
   * @param options Optional transport options including `AbortSignal` for
   *                cancellation.
   * @returns A promise that resolves to a receipt indicating success or
   *          failure.
   */
  send(message: Message, options?: TransportOptions): Promise<Receipt<'mailgun'>>;
  /**
   * Sends multiple email messages efficiently via Mailgun API.
   *
   * This method sends each message individually but provides a streamlined
   * interface for processing multiple messages. Each message is sent as a
   * separate API request to Mailgun.
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
  ): AsyncIterable<Receipt<'mailgun'>>;
}

/**
 * Error thrown when a Mailgun API request fails.
 */
export declare class MailgunApiError extends Error {
  /**
   * HTTP status code returned by Mailgun, if the request reached the API.
   */
  statusCode?: number;
  /**
   * Retry delay from Mailgun's `Retry-After` response header.
   */
  retryAfterMilliseconds?: number;
  /**
   * Number of attempts made before this error was produced.
   */
  attempts?: number;
  /**
   * Creates a Mailgun API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code returned by Mailgun.
   * @param retryAfterMilliseconds Retry delay from the response.
   * @param attempts Number of attempts made before this error.
   */
  constructor(
    message: string,
    statusCode?: number,
    retryAfterMilliseconds?: number,
    attempts?: number,
  );
}
