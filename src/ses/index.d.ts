// Types ported from upyo v0.7.0 (packages/ses/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

import type { Message, Receipt, Transport, TransportOptions } from '../../index.js';

/**
 * Authentication configuration for AWS SES.
 *
 * This is a discriminated union type that supports two authentication methods:
 *
 * - `credentials`: Basic access key and secret key authentication
 * - `session`: Temporary credentials with session token
 *
 * **Note**: IAM role assumption (`assumeRole`) is not currently supported.
 * If you need to use IAM roles, perform the AssumeRole operation externally
 * (e.g., using AWS CLI or SDK) and use the resulting temporary credentials
 * with the `session` authentication type.
 *
 * @example
 * ```typescript
 * // Basic credentials
 * const auth: SesAuthentication = {
 *   type: "credentials",
 *   accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 * };
 *
 * // Session credentials (from external AssumeRole)
 * const sessionAuth: SesAuthentication = {
 *   type: "session",
 *   accessKeyId: "ASIAXYZ...",
 *   secretAccessKey: "abc123...",
 *   sessionToken: "FwoGZXIvYXdzE...",
 * };
 * ```
 */
export type SesAuthentication =
  | {
      /** Authentication type identifier. */
      readonly type: 'credentials';
      /** AWS access key ID. */
      readonly accessKeyId: string;
      /** AWS secret access key. */
      readonly secretAccessKey: string;
    }
  | {
      /** Authentication type identifier. */
      readonly type: 'session';
      /** AWS access key ID for temporary credentials. */
      readonly accessKeyId: string;
      /** AWS secret access key for temporary credentials. */
      readonly secretAccessKey: string;
      /** AWS session token for temporary credentials. */
      readonly sessionToken: string;
    };
/**
 * Configuration options for the Amazon SES transport.
 *
 * @example
 * ```typescript
 * const config: SesConfig = {
 *   authentication: {
 *     type: "credentials",
 *     accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 *   },
 *   region: "us-east-1",
 *   timeout: 30000,
 *   retries: 3,
 *   batchSize: 25,
 *   defaultTags: {
 *     environment: "production",
 *     service: "notifications",
 *   },
 * };
 * ```
 */
export interface SesConfig {
  /** AWS authentication configuration. */
  readonly authentication: SesAuthentication;
  /**
   * AWS region.
   * @default "us-east-1"
   */
  readonly region?: string;
  /**
   * Request timeout in milliseconds.
   * The response body is included; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Number of retry attempts on failure.
   * @default 3
   */
  readonly retries?: number;
  /**
   * Whether to validate SSL certificates.
   * @default true
   */
  readonly validateSsl?: boolean;
  /** Additional HTTP headers to include in requests. */
  readonly headers?: Record<string, string>;
  /** SES configuration set name for tracking and reputation management. */
  readonly configurationSetName?: string;
  /** Default tags to apply to all sent emails. */
  readonly defaultTags?: Record<string, string>;
  /**
   *  Maximum number of messages to send concurrently in sendMany().
   * @default 50
   */
  readonly batchSize?: number;
}
/**
 * Resolved SES configuration with all optional fields filled with default values.
 *
 * This type is returned by `createSesConfig()` and used internally by `SesTransport`.
 * It ensures all required fields have values, making the transport implementation simpler.
 */
type ResolvedSesConfig = Required<
  Omit<SesConfig, 'configurationSetName' | 'defaultTags' | 'batchSize'>
> & {
  /** SES configuration set name (optional) */
  readonly configurationSetName?: string;
  /** Default tags to apply to all emails (always defined, may be empty) */
  readonly defaultTags: Record<string, string>;
  /** Maximum concurrent messages in batch operations */
  readonly batchSize: number;
};
/**
 * Creates a resolved SES configuration with default values applied.
 *
 * This function takes a partial SES configuration and fills in default values
 * for all optional fields, ensuring the transport has all necessary configuration.
 *
 * @example
 * ```typescript
 * const config = createSesConfig({
 *   authentication: {
 *     type: "credentials",
 *     accessKeyId: "AKIA...",
 *     secretAccessKey: "wJal..",
 *   },
 *   region: "eu-west-1",
 * });
 *
 * // config.timeout is now 30000 (default)
 * // config.retries is now 3 (default)
 * // config.batchSize is now 50 (default)
 * ```
 *
 * @param config The SES configuration object.
 * @returns A resolved configuration with all defaults applied.
 */

/**
 * Amazon SES email transport implementation.
 *
 * This transport sends emails through the AWS Simple Email Service (SES) using
 * the v2 API.  It supports AWS Signature v4 authentication, configurable
 * retries, and concurrent batch sending.
 *
 * @example
 * ```typescript
 * import { SesTransport } from "@alexify/mailer/ses";
 * import { createMessage } from "@alexify/mailer";
 *
 * const transport = new SesTransport({
 *   authentication: {
 *     type: "credentials",
 *     accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 *   },
 *   region: "us-east-1",
 * });
 *
 * const message = createMessage({
 *   from: "sender@example.com",
 *   to: "recipient@example.com",
 *   subject: "Hello from SES",
 *   content: { text: "This is a test message" },
 * });
 *
 * const receipt = await transport.send(message);
 * if (receipt.successful) {
 *   console.log("Email sent with ID:", receipt.messageId);
 * }
 * ```
 */
export declare class SesTransport implements Transport<'ses'> {
  readonly id = 'ses';
  /** Resolved configuration with defaults applied */
  config: ResolvedSesConfig;
  /**
   * Creates a new SES transport instance.
   *
   * @param config SES configuration options.
   */
  constructor(config: SesConfig);
  /**
   * Sends a single email message through Amazon SES.
   *
   * This method converts the message to SES format, sends it via the SES v2 API,
   * and returns a receipt indicating success or failure.
   *
   * @example
   * ```typescript
   * const message = createMessage({
   *   from: "sender@example.com",
   *   to: "recipient@example.com",
   *   subject: "Hello",
   *   content: { text: "Hello, world!" },
   *   attachments: [{
   *     filename: "document.pdf",
   *     content: Promise.resolve(pdfBytes),
   *     contentType: "application/pdf",
   *   }],
   * });
   *
   * const receipt = await transport.send(message);
   * ```
   *
   * @param message The email message to send.
   * @param options Optional transport options (e.g., abort signal).
   * @returns A promise that resolves to a receipt with the result.
   */
  send(message: Message, options?: TransportOptions): Promise<Receipt<'ses'>>;
  /**
   * Sends multiple email messages concurrently through Amazon SES.
   *
   * This method processes messages in batches (configurable via `batchSize`)
   * and sends each batch concurrently to improve performance. It yields
   * receipts as they become available, allowing for streaming processing of
   * results.
   *
   * @example
   * ```typescript
   * const messages = [
   *   createMessage({ from: "sender@example.com", to: "user1@example.com", subject: "Hello 1", content: { text: "Message 1" } }),
   *   createMessage({ from: "sender@example.com", to: "user2@example.com", subject: "Hello 2", content: { text: "Message 2" } }),
   *   createMessage({ from: "sender@example.com", to: "user3@example.com", subject: "Hello 3", content: { text: "Message 3" } }),
   * ];
   *
   * for await (const receipt of transport.sendMany(messages)) {
   *   if (receipt.successful) {
   *     console.log("Sent:", receipt.messageId);
   *   } else {
   *     console.error("Failed:", receipt.errorMessages);
   *   }
   * }
   * ```
   *
   * @param messages An iterable or async iterable of messages to send.
   * @param options Optional transport options (e.g., abort signal).
   * @returns Individual receipts for each message as they complete.
   */
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'ses'>>;
}
