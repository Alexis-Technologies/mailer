// Types ported from upyo v0.7.0 (packages/sendgrid/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

import type { Message, Receipt, Transport, TransportOptions } from '../../index.js';

/**
 * Configuration interface for SendGrid transport connection settings.
 *
 * This interface defines all available options for configuring a SendGrid
 * API connection including authentication, HTTP options, and tracking settings.
 *
 * @example
 * ```typescript
 * const config: SendGridConfig = {
 *   apiKey: 'your-api-key',
 *   timeout: 30000,
 *   retries: 3,
 *   tracking: true
 * };
 * ```
 */
export interface SendGridConfig {
  /**
   * Your SendGrid API key.
   *
   * You can find your API key in the SendGrid Control Panel under Settings > API Keys.
   * It should start with 'SG.' for v3 API keys.
   */
  readonly apiKey: string;
  /**
   * Base URL for the SendGrid API.
   *
   * @default "https://api.sendgrid.com/v3"
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
  /**
   * Whether to enable subscription tracking for sent messages.
   *
   * @default false
   */
  readonly subscriptionTracking?: boolean;
  /**
   * Whether to enable Google Analytics tracking for sent messages.
   *
   * @default false
   */
  readonly googleAnalytics?: boolean;
}
/**
 * Resolved SendGrid configuration with all optional fields filled with default values.
 *
 * This type represents the final configuration after applying defaults,
 * used internally by the SendGrid transport implementation.
 */
type ResolvedSendGridConfig = Required<SendGridConfig>;
/**
 * Creates a resolved SendGrid configuration by applying default values to optional fields.
 *
 * This function takes a partial SendGrid configuration and returns a complete
 * configuration with all optional fields filled with sensible defaults.
 * It is used internally by the SendGrid transport.
 *
 * @param config - The SendGrid configuration with optional fields
 * @returns A resolved configuration with all defaults applied
 * @internal
 */

/**
 * SendGrid transport implementation for sending emails via SendGrid API.
 *
 * This transport provides efficient email delivery using SendGrid's v3 HTTP API,
 * with support for authentication, retry logic, and batch sending capabilities.
 *
 * @example
 * ```typescript
 * import { SendGridTransport } from '@alexify/mailer/sendgrid';
 *
 * const transport = new SendGridTransport({
 *   apiKey: 'your-sendgrid-api-key',
 *   clickTracking: true,
 *   openTracking: true
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
export declare class SendGridTransport implements Transport<'sendgrid'> {
  readonly id = 'sendgrid';
  /**
   * The resolved SendGrid configuration used by this transport.
   */
  config: ResolvedSendGridConfig;
  /**
   * Creates a new SendGrid transport instance.
   *
   * @param config SendGrid configuration including API key and options.
   */
  constructor(config: SendGridConfig);
  /**
   * Sends a single email message via SendGrid API.
   *
   * This method converts the message to SendGrid format, makes an HTTP request
   * to the SendGrid API, and returns a receipt with the result.
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
  send(message: Message, options?: TransportOptions): Promise<Receipt<'sendgrid'>>;
  /**
   * Sends multiple email messages efficiently via SendGrid API.
   *
   * This method sends each message individually but provides a streamlined
   * interface for processing multiple messages. Each message is sent as a
   * separate API request to SendGrid.
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
  ): AsyncIterable<Receipt<'sendgrid'>>;
}

/**
 * Error thrown when a SendGrid API request fails.
 */
export declare class SendGridApiError extends Error {
  /**
   * HTTP status code returned by SendGrid, if the request reached the API.
   */
  readonly statusCode?: number;
  /**
   * Provider-supplied SendGrid error details.
   */
  readonly errors?: {
    readonly message: string;
    readonly field?: string;
    readonly help?: string;
  }[];
  /**
   * Retry delay from SendGrid's `Retry-After` response header.
   */
  readonly retryAfterMilliseconds?: number;
  /**
   * Number of attempts made before this error was produced.
   */
  readonly attempts?: number;
  /**
   * Creates a SendGrid API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code returned by SendGrid.
   * @param errors Provider-supplied SendGrid error details.
   * @param retryAfterMilliseconds Retry delay from the response.
   * @param attempts Number of attempts made before this error.
   */
  constructor(
    message: string,
    statusCode?: number,
    errors?: Array<{
      message: string;
      field?: string;
      help?: string;
    }>,
    retryAfterMilliseconds?: number,
    attempts?: number,
  );
}
