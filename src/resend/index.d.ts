// Types ported from upyo v0.7.0 (packages/resend/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

import { Message, Receipt, Transport, TransportOptions } from '../../index.js';

/**
 * Configuration interface for Resend transport connection settings.
 *
 * This interface defines all available options for configuring a Resend
 * API connection including authentication and HTTP options.
 *
 * @example
 * ```typescript
 * const config: ResendConfig = {
 *   apiKey: 'your-api-key',
 *   timeout: 30000,
 *   retries: 3
 * };
 * ```
 */
export interface ResendConfig {
  /**
   * Your Resend API key.
   *
   * You can find your API key in the Resend dashboard at https://resend.com/api-keys.
   * It should start with 're_' for API keys.
   */
  readonly apiKey: string;
  /**
   * Base URL for the Resend API.
   *
   * @default "https://api.resend.com"
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
}
/**
 * Resolved Resend configuration with all optional fields filled with default values.
 *
 * This type represents the final configuration after applying defaults,
 * used internally by the Resend transport implementation.
 */
export type ResolvedResendConfig = Required<ResendConfig>;
/**
 * Creates a resolved Resend configuration by applying default values to optional fields.
 *
 * This function takes a partial Resend configuration and returns a complete
 * configuration with all optional fields filled with sensible defaults.
 * It is used internally by the Resend transport.
 *
 * @param config - The Resend configuration with optional fields
 * @returns A resolved configuration with all defaults applied
 * @internal
 */

/**
 * Resend transport implementation for sending emails via Resend API.
 *
 * This transport provides efficient email delivery using Resend's HTTP API,
 * with support for authentication, retry logic, batch sending capabilities,
 * and idempotency for reliable delivery.
 *
 * @example
 * ```typescript
 * import { ResendTransport } from '@alexify/mailer/resend';
 *
 * const transport = new ResendTransport({
 *   apiKey: 'your-resend-api-key',
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
export declare class ResendTransport implements Transport<'resend'> {
  readonly id = 'resend';
  /**
   * The resolved Resend configuration used by this transport.
   */
  config: ResolvedResendConfig;
  /**
   * Creates a new Resend transport instance.
   *
   * @param config Resend configuration including API key and options.
   */
  constructor(config: ResendConfig);
  /**
   * Sends a single email message via Resend API.
   *
   * This method converts the message to Resend format, makes an HTTP request
   * to the Resend API with automatic idempotency key generation, and returns
   * a receipt with the result.
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
  send(message: Message, options?: TransportOptions): Promise<Receipt<'resend'>>;
  /**
   * Sends multiple email messages efficiently via Resend API.
   *
   * This method intelligently chooses between single requests and batch API
   * based on message count and features used. For optimal performance:
   * - Uses batch API for ≤100 messages without attachments or tags
   * - Falls back to individual requests for messages with unsupported features
   * - Chunks large batches (>100) into multiple batch requests
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
  ): AsyncIterable<Receipt<'resend'>>;
}

/**
 * Response from Resend API for sending a single message.
 */
export interface ResendResponse {
  /**
   * The message ID returned by Resend.
   */
  id: string;
}
/**
 * Response from Resend API for sending batch messages.
 */
export interface ResendBatchResponse {
  /**
   * Array of message objects with IDs.
   */
  data: Array<{
    id: string;
  }>;
}
/**
 * Error response from Resend API.
 */
export interface ResendError {
  /**
   * Error message from Resend.
   */
  message: string;
  /**
   * Error name/type.
   */
  name?: string;
}
/**
 * Error thrown when a Resend API request fails.
 */
// A type only, as upstream exports it: the class is not exported at runtime.
declare class ResendApiError extends Error {
  /**
   * HTTP status code returned by Resend, if the request reached the API.
   */
  readonly statusCode?: number;
  /**
   * Retry delay from Resend's `Retry-After` response header.
   */
  readonly retryAfterMilliseconds?: number;
  /**
   * Number of attempts made before this error was produced.
   */
  readonly attempts?: number;
  /**
   * Creates a Resend API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code returned by Resend.
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
/**
 * HTTP client wrapper for Resend API requests.
 *
 * This class handles authentication, request formatting, error handling,
 * and retry logic for Resend API calls.
 */

export type { ResendApiError };
