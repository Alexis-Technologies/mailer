// Types ported from upyo v0.7.0 (packages/maileroo/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

import type {
  Message,
  Receipt,
  Transport,
  TransportDependencies,
  TransportOptions,
} from '../../index.js';

/**
 * Configuration interface for Maileroo transport connection settings.
 *
 * @example
 * ```typescript
 * const config: MailerooConfig = {
 *   apiKey: "your-sending-key",
 *   timeout: 30000,
 *   retries: 3,
 * };
 * ```
 */
export interface MailerooConfig extends TransportDependencies {
  /**
   * Your Maileroo sending key.
   *
   * The key is sent as an `X-API-Key` HTTP header.
   */
  readonly apiKey: string;
  /**
   * Base URL for the Maileroo Email API.
   *
   * @default "https://smtp.maileroo.com/api/v2"
   */
  readonly baseUrl?: string;
  /**
   * HTTP request timeout in milliseconds.
   *
   * Set to `0` or `Infinity` to disable request timeouts.
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
   * Additional HTTP headers to include with requests.
   */
  readonly headers?: Record<string, string>;
  /**
   * Whether Maileroo should track opens and clicks for sent messages.
   *
   * When omitted, Maileroo applies the account default.
   */
  readonly tracking?: boolean;
  /**
   * Default Maileroo tags to apply to sent messages.
   */
  readonly tags?: Record<string, string>;
}
/**
 * Resolved Maileroo configuration with defaults applied.
 */
export type ResolvedMailerooConfig = Required<
  Omit<MailerooConfig, 'tracking' | 'tags' | keyof TransportDependencies>
> &
  TransportDependencies & {
    readonly tracking?: boolean;
    readonly tags?: Record<string, string>;
  };
/**
 * Creates a resolved Maileroo configuration by applying default values.
 *
 * @param config The Maileroo configuration with optional fields.
 * @returns A resolved configuration with all defaults applied.
 */
export declare function createMailerooConfig(config: MailerooConfig): ResolvedMailerooConfig;

/**
 * Maileroo transport implementation for sending emails via Maileroo API.
 *
 * @example
 * ```typescript
 * import { createMessage } from "@alexify/mailer";
 * import { MailerooTransport } from "@alexify/mailer/maileroo";
 *
 * const transport = new MailerooTransport({
 *   apiKey: "your-sending-key",
 * });
 *
 * const receipt = await transport.send(createMessage({
 *   from: "sender@example.com",
 *   to: "recipient@example.com",
 *   subject: "Hello from Maileroo",
 *   content: { text: "Hello!" },
 * }));
 * ```
 */
export declare class MailerooTransport implements Transport<'maileroo'> {
  readonly id = 'maileroo';
  /**
   * The resolved Maileroo configuration used by this transport.
   */
  readonly config: ResolvedMailerooConfig;
  /**
   * Creates a new Maileroo transport instance.
   *
   * @param config Maileroo configuration including API key and options.
   */
  constructor(config: MailerooConfig);
  /**
   * Sends a single email message via Maileroo API.
   *
   * @param message The email message to send.
   * @param options Optional transport options including `AbortSignal`.
   * @returns A receipt indicating success or failure.
   * @throws {Error} If the caller aborts the operation.
   */
  send(message: Message, options?: TransportOptions): Promise<Receipt<'maileroo'>>;
  /**
   * Sends multiple email messages sequentially via Maileroo API.
   *
   * @param messages An iterable or async iterable of messages to send.
   * @param options Optional transport options including `AbortSignal`.
   * @returns An async iterable of receipts, one for each message.
   */
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'maileroo'>>;
}

/**
 * Maileroo email address object.
 */
export interface MailerooEmailAddress {
  /** Email address. */
  readonly address: string;
  /** Optional display name. */
  readonly display_name?: string;
}
/**
 * Maileroo attachment object.
 */
export interface MailerooAttachment {
  /** Attachment filename or inline content ID. */
  readonly file_name: string;
  /** Attachment MIME type. */
  readonly content_type?: string;
  /** Base64-encoded attachment content. */
  readonly content: string;
  /** Whether this attachment is treated as inline content. */
  readonly inline?: boolean;
}
/**
 * Maileroo email object structure for API requests.
 */
export interface MailerooEmail {
  readonly from: MailerooEmailAddress;
  readonly to: MailerooEmailAddress | readonly MailerooEmailAddress[];
  readonly cc?: MailerooEmailAddress | readonly MailerooEmailAddress[];
  readonly bcc?: MailerooEmailAddress | readonly MailerooEmailAddress[];
  readonly reply_to?: MailerooEmailAddress | readonly MailerooEmailAddress[];
  readonly subject: string;
  readonly html?: string;
  readonly plain?: string;
  readonly tracking?: boolean;
  readonly tags?: Record<string, string>;
  readonly headers?: Record<string, string>;
  readonly attachments?: readonly MailerooAttachment[];
  readonly reference_id?: string;
}
/**
 * Converts an Upyo message to Maileroo API JSON format.
 *
 * @param message The Upyo message to convert.
 * @param config The resolved Maileroo configuration.
 * @param signal Optional abort signal for cancellation.
 * @returns JSON object ready for Maileroo API submission.
 * @throws {TypeError} If the message carries an invalid message identifier.
 * @throws {Error} If the caller aborts the operation.
 */

/**
 * Response from Maileroo API for sending a single message.
 */
export interface MailerooResponse {
  /** Whether Maileroo accepted the request. */
  readonly success: boolean;
  /** Human-readable response message. */
  readonly message?: string;
  /** Response payload from Maileroo. */
  readonly data?: {
    /** Maileroo reference ID for tracking the message. */
    readonly reference_id?: string;
  };
}
/**
 * Error response from Maileroo API.
 */
export interface MailerooError {
  /** Error message from Maileroo. */
  readonly message?: string;
  /** Error detail from Maileroo. */
  readonly error?: string;
  /** Validation errors from Maileroo. */
  readonly errors?: readonly unknown[];
}
/**
 * Maileroo API error class for API-specific failures.
 */
export declare class MailerooApiError extends Error {
  readonly statusCode: number;
  readonly retryAfterMilliseconds?: number;
  readonly attempts?: number;
  /**
   * Creates a Maileroo API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code.
   * @param retryAfterMilliseconds Retry delay from the response.
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
 * Maileroo request timeout error.
 */
export declare class MailerooTimeoutError extends Error {
  /**
   * Request timeout in milliseconds.
   */
  readonly timeout: number;
  /**
   * Number of attempts made before this error was produced.
   */
  readonly attempts?: number;
  /**
   * Creates a Maileroo request timeout error.
   *
   * @param timeout Request timeout in milliseconds.
   * @param attempts Number of attempts made before this error.
   */
  constructor(timeout: number, attempts?: number);
}
/**
 * HTTP client wrapper for Maileroo API requests.
 */
