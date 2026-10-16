// Types ported from upyo v0.7.0 (packages/mailtrap/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

import type {
  Message,
  Receipt,
  Transport,
  TransportDependencies,
  TransportOptions,
} from '../../index.js';

/**
 * Configuration interface for Mailtrap transport connection settings.
 *
 * @example
 * ```typescript
 * const config: MailtrapConfig = {
 *   apiToken: "your-api-token",
 *   sandbox: true,
 *   inboxId: 12345,
 *   timeout: 30000,
 *   retries: 3,
 * };
 * ```
 */
export interface MailtrapConfig extends TransportDependencies {
  /**
   * Your Mailtrap API token.
   *
   * The token is sent as the `Api-Token` HTTP header.
   */
  readonly apiToken: string;
  /**
   * Whether to send through Mailtrap Email Sandbox instead of Email API.
   *
   * @default false
   */
  readonly sandbox?: boolean;
  /**
   * Sandbox inbox ID (from `mailtrap.io/sandboxes/{id}`).
   *
   * Required when `sandbox` is `true`.
   */
  readonly inboxId?: string | number;
  /**
   * Base URL for Mailtrap Email API (production sending).
   *
   * @default "https://send.api.mailtrap.io"
   */
  readonly sendBaseUrl?: string;
  /**
   * Base URL for Mailtrap Email Sandbox.
   *
   * @default "https://sandbox.api.mailtrap.io"
   */
  readonly sandboxBaseUrl?: string;
  /**
   * Default Mailtrap category when the Upyo message has no tags.
   *
   * @default "transactional"
   */
  readonly defaultCategory?: string;
  /**
   * Metadata to track with sent messages.  This metadata is not added as
   * email headers.
   */
  readonly metadata?: Record<string, string>;
  /**
   * User-Agent header sent with every request.
   *
   * Mailtrap edge protection may block requests without a User-Agent.
   *
   * @default "@alexify/mailer/mailtrap"
   */
  readonly userAgent?: string;
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
 * Resolved Mailtrap configuration with defaults applied.
 */
export type ResolvedMailtrapConfig = Required<
  Omit<
    MailtrapConfig,
    | 'inboxId'
    | 'sandbox'
    | 'metadata'
    | 'defaultCategory'
    | 'userAgent'
    | 'sendBaseUrl'
    | 'sandboxBaseUrl'
    | keyof TransportDependencies
  >
> &
  TransportDependencies & {
    readonly inboxId?: string | number;
    readonly sandbox: boolean;
    readonly metadata?: Record<string, string>;
    readonly defaultCategory: string;
    readonly userAgent: string;
    readonly sendBaseUrl: string;
    readonly sandboxBaseUrl: string;
  };
/**
 * Creates a resolved Mailtrap configuration by applying default values.
 *
 * @param config The Mailtrap configuration with optional fields.
 * @returns A resolved configuration with all defaults applied.
 * @throws {RangeError} If `sandbox` is `true` and `inboxId` is missing.
 */
export declare function createMailtrapConfig(config: MailtrapConfig): ResolvedMailtrapConfig;

/**
 * Mailtrap transport implementation for sending emails via Mailtrap API.
 *
 * @example
 * ```typescript
 * import { createMessage } from "@alexify/mailer";
 * import { MailtrapTransport } from "@alexify/mailer/mailtrap";
 *
 * const transport = new MailtrapTransport({
 *   apiToken: "your-api-token",
 *   sandbox: true,
 *   inboxId: 12345,
 * });
 *
 * const receipt = await transport.send(createMessage({
 *   from: "sender@example.com",
 *   to: "recipient@example.com",
 *   subject: "Hello from Mailtrap",
 *   content: { text: "Hello!" },
 * }));
 * ```
 */
export declare class MailtrapTransport implements Transport<'mailtrap'> {
  readonly id = 'mailtrap';
  /**
   * The resolved Mailtrap configuration used by this transport.
   */
  readonly config: ResolvedMailtrapConfig;
  /**
   * Creates a new Mailtrap transport instance.
   *
   * @param config Mailtrap configuration including API token and options.
   */
  constructor(config: MailtrapConfig);
  /**
   * Sends a single email message via Mailtrap API.
   *
   * @param message The email message to send.
   * @param options Optional transport options including `AbortSignal`.
   * @returns A receipt indicating success or failure.
   * @throws {Error} If the caller aborts the operation.
   */
  send(message: Message, options?: TransportOptions): Promise<Receipt<'mailtrap'>>;
  /**
   * Sends multiple email messages via Mailtrap batch API.
   *
   * Messages are chunked into Mailtrap's maximum batch size of 500 messages.
   *
   * @param messages An iterable or async iterable of messages to send.
   * @param options Optional transport options including `AbortSignal`.
   * @returns An async iterable of receipts, one for each message.
   */
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'mailtrap'>>;
}

/**
 * Mailtrap address object structure.
 */
export interface MailtrapAddress {
  readonly email: string;
  readonly name?: string;
}
/**
 * Mailtrap attachment object structure.
 */
export interface MailtrapAttachment {
  readonly content: string;
  readonly filename: string;
  readonly type?: string;
  readonly disposition?: string;
  readonly content_id?: string;
}
/**
 * Mailtrap email object structure for API requests.
 */
export interface MailtrapEmail {
  readonly from: MailtrapAddress;
  readonly to: readonly MailtrapAddress[];
  readonly subject: string;
  readonly cc?: readonly MailtrapAddress[];
  readonly bcc?: readonly MailtrapAddress[];
  readonly reply_to?: MailtrapAddress;
  readonly text?: string;
  readonly html?: string;
  readonly headers?: Record<string, string>;
  readonly attachments?: readonly MailtrapAttachment[];
  readonly category: string;
  readonly custom_variables?: Record<string, string>;
}
/**
 * Converts an Upyo message to Mailtrap API JSON format.
 *
 * @param message The Upyo message to convert.
 * @param config The resolved Mailtrap configuration.
 * @param signal Optional abort signal for cancellation.
 * @returns JSON object ready for Mailtrap API submission.
 * @throws {TypeError} If the message carries an invalid message identifier.
 * @throws {RangeError} If the message has no text or HTML content.
 * @throws {Error} If the caller aborts the operation.
 */

/**
 * Response from Mailtrap API for sending a single message.
 */
export interface MailtrapSendResponse {
  readonly success?: boolean;
  readonly message_ids?: readonly string[];
  readonly errors?: readonly string[];
}
/**
 * Response for an individual message in a Mailtrap batch send.
 */
export interface MailtrapBatchItemResponse {
  readonly success?: boolean;
  readonly message_ids?: readonly string[];
  readonly errors?: readonly string[];
}
/**
 * Response from Mailtrap API for sending batch messages.
 */
export interface MailtrapBatchResponse {
  readonly success?: boolean;
  readonly responses?: readonly MailtrapBatchItemResponse[];
  readonly errors?: readonly string[];
}
/**
 * Error response from Mailtrap API.
 */
export interface MailtrapError {
  readonly message?: string;
  readonly errors?: readonly string[];
}
/**
 * Mailtrap API error class for API-specific failures.
 */
export declare class MailtrapApiError extends Error {
  readonly statusCode: number;
  readonly retryAfterMilliseconds?: number;
  readonly attempts?: number;
  /**
   * Creates a Mailtrap API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code.
   * @param retryAfterMilliseconds Retry delay from the response or Mailtrap's
   * known sandbox rate-limit window.
   * @param attempts Number of attempts made before this error.
   */
  constructor(
    message: string,
    statusCode: number,
    retryAfterMilliseconds?: number,
    attempts?: number,
  );
}
/**
 * Mailtrap request timeout error.
 */
export declare class MailtrapTimeoutError extends Error {
  /**
   * Request timeout in milliseconds.
   */
  readonly timeout: number;
  /**
   * Number of attempts made before this error was produced.
   */
  readonly attempts?: number;
  /**
   * Creates a Mailtrap request timeout error.
   *
   * @param timeout Request timeout in milliseconds.
   * @param attempts Number of attempts made before this error.
   */
  constructor(timeout: number, attempts?: number);
}
/**
 * Failure to read a successful Mailtrap response after the request was accepted.
 * Retrying the request could send the message again.
 */
export declare class MailtrapResponseError extends Error {
  /**
   * Number of attempts made before this error was produced.
   */
  readonly attempts?: number;
  /**
   * Creates an error for an unreadable successful response.
   *
   * @param cause The response body error, including a possible timeout.
   * @param attempts Number of attempts made before this error.
   */
  constructor(cause: unknown, attempts?: number);
}
/**
 * HTTP client wrapper for Mailtrap API requests.
 */
