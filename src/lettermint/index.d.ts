// Types ported from upyo v0.7.0 (packages/lettermint/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

import type {
  Message,
  Receipt,
  Transport,
  TransportDependencies,
  TransportOptions,
} from '../../index.js';

/**
 * Per-email Lettermint tracking settings.
 *
 * These settings are sent as provider-specific defaults for every message
 * delivered through a {@link LettermintTransport}.
 */
export interface LettermintSettings {
  /**
   * Whether Lettermint should track email opens.
   */
  readonly trackOpens?: boolean;
  /**
   * Whether Lettermint should track link clicks.
   */
  readonly trackClicks?: boolean;
}
/**
 * Configuration interface for Lettermint transport connection settings.
 *
 * @example
 * ```typescript
 * const config: LettermintConfig = {
 *   apiToken: "your-project-api-token",
 *   route: "transactional",
 *   tag: "welcome",
 *   timeout: 30000,
 *   retries: 3,
 * };
 * ```
 */
export interface LettermintConfig extends TransportDependencies {
  /**
   * Your project-specific Lettermint sending API token.
   *
   * The token is sent as the `x-lettermint-token` HTTP header.
   */
  readonly apiToken: string;
  /**
   * Base URL for the Lettermint API.
   *
   * @default "https://api.lettermint.co"
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
   * Additional HTTP headers to include with requests.
   */
  readonly headers?: Record<string, string>;
  /**
   * Lettermint route to apply to sent messages.
   */
  readonly route?: string;
  /**
   * Default Lettermint tag to apply when the Upyo message has no tag.
   */
  readonly tag?: string | null;
  /**
   * Metadata to track with sent messages.  This metadata is not added as
   * email headers.
   */
  readonly metadata?: Record<string, string>;
  /**
   * Lettermint tracking settings to apply to sent messages.
   */
  readonly settings?: LettermintSettings;
}
/**
 * Resolved Lettermint configuration with defaults applied.
 */
export type ResolvedLettermintConfig = Required<
  Omit<LettermintConfig, 'route' | 'tag' | 'metadata' | 'settings' | keyof TransportDependencies>
> &
  TransportDependencies & {
    readonly route?: string;
    readonly tag?: string | null;
    readonly metadata?: Record<string, string>;
    readonly settings?: LettermintSettings;
  };
/**
 * Creates a resolved Lettermint configuration by applying default values.
 *
 * @param config The Lettermint configuration with optional fields.
 * @returns A resolved configuration with all defaults applied.
 */
export declare function createLettermintConfig(config: LettermintConfig): ResolvedLettermintConfig;

/**
 * Lettermint transport implementation for sending emails via Lettermint API.
 *
 * @example
 * ```typescript
 * import { createMessage } from "@alexify/mailer";
 * import { LettermintTransport } from "@alexify/mailer/lettermint";
 *
 * const transport = new LettermintTransport({
 *   apiToken: "your-project-api-token",
 * });
 *
 * const receipt = await transport.send(createMessage({
 *   from: "sender@example.com",
 *   to: "recipient@example.com",
 *   subject: "Hello from Lettermint",
 *   content: { text: "Hello!" },
 * }));
 * ```
 */
export declare class LettermintTransport implements Transport<'lettermint'> {
  readonly id = 'lettermint';
  /**
   * The resolved Lettermint configuration used by this transport.
   */
  config: ResolvedLettermintConfig;
  /**
   * Creates a new Lettermint transport instance.
   *
   * @param config Lettermint configuration including API token and options.
   */
  constructor(config: LettermintConfig);
  /**
   * Sends a single email message via Lettermint API.
   *
   * @param message The email message to send.
   * @param options Optional transport options including `AbortSignal`.
   * @returns A receipt indicating success or failure.
   */
  send(message: Message, options?: TransportOptions): Promise<Receipt<'lettermint'>>;
  /**
   * Sends multiple email messages via Lettermint batch API.
   *
   * Messages are chunked into Lettermint's maximum batch size of 500 messages.
   *
   * @param messages An iterable or async iterable of messages to send.
   * @param options Optional transport options including `AbortSignal`.
   * @returns An async iterable of receipts, one for each message.
   */
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'lettermint'>>;
}

/**
 * Lettermint message status values.
 */
export type LettermintStatus =
  | 'pending'
  | 'queued'
  | 'suppressed'
  | 'processed'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'soft_bounced'
  | 'hard_bounced'
  | 'spam_complaint'
  | 'failed'
  | 'blocked'
  | 'policy_rejected'
  | 'unsubscribed';
/**
 * Response from Lettermint API for sending a single message.
 */
export interface LettermintResponse {
  /** The message ID returned by Lettermint. */
  readonly message_id: string;
  /** Current message status. */
  readonly status: LettermintStatus;
}
/**
 * Response from Lettermint API for sending batch messages.
 */
export type LettermintBatchResponse = readonly LettermintResponse[];
/**
 * Error response from Lettermint API.
 */
export interface LettermintError {
  /** Error message from Lettermint. */
  readonly message?: string;
  /** Error detail from Lettermint. */
  readonly error?: string;
  /** Validation errors from Lettermint. */
  readonly errors?: readonly unknown[];
}
/**
 * Lettermint API error class for API-specific failures.
 */
export declare class LettermintApiError extends Error {
  readonly statusCode: number;
  readonly retryAfterMilliseconds?: number;
  readonly attempts?: number;
  /**
   * Creates a Lettermint API error.
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
 * Lettermint request timeout error.
 */
export declare class LettermintTimeoutError extends Error {
  /**
   * Request timeout in milliseconds.
   */
  readonly timeout: number;
  /**
   * Number of attempts made before this error was produced.
   */
  readonly attempts?: number;
  /**
   * Creates a Lettermint request timeout error.
   *
   * @param timeout Request timeout in milliseconds.
   * @param attempts Number of attempts made before this error.
   */
  constructor(timeout: number, attempts?: number);
}
/**
 * HTTP client wrapper for Lettermint API requests.
 */
