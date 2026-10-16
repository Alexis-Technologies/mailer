// Types ported from upyo v0.7.0 (packages/jmap/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

import type {
  Message,
  RawMessage,
  RawTransport,
  Receipt,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

/**
 * Configuration interface for JMAP transport connection settings.
 */
export interface JmapConfig {
  /**
   * The JMAP session URL (e.g., `https://server/.well-known/jmap`).
   * This is used for session discovery per RFC 8620 Section 2.
   */
  readonly sessionUrl: string;
  /**
   * Bearer token for authentication.
   * Used in Authorization header as `Bearer {token}`.
   * Either `bearerToken` or `basicAuth` must be provided.
   */
  readonly bearerToken?: string;
  /**
   * Basic authentication credentials.
   * Used in Authorization header as `Basic {base64(username:password)}`.
   * Either `bearerToken` or `basicAuth` must be provided.
   */
  readonly basicAuth?: {
    readonly username: string;
    readonly password: string;
  };
  /**
   * The JMAP account ID to use.
   * If not provided, will be auto-detected from the session response
   * (first account with mail capability).
   */
  readonly accountId?: string;
  /**
   * The identity ID to use for email submission.
   * If not provided, will be auto-resolved based on sender email address.
   */
  readonly identityId?: string;
  /**
   * HTTP request timeout in milliseconds, response body included; 0 or
   * `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Number of retry attempts for failed requests.
   * @default 3
   */
  readonly retries?: number;
  /**
   * Custom HTTP headers to include with requests.
   */
  readonly headers?: Record<string, string>;
  /**
   * Session cache TTL in milliseconds.
   * Sessions are refreshed when capabilities errors occur or after this duration.
   * @default 300000 (5 minutes)
   */
  readonly sessionCacheTtl?: number;
  /**
   * Base URL to use for rewriting session URLs.
   * Some JMAP servers return internal hostnames in session responses.
   * When set, URLs from the session (apiUrl, uploadUrl, etc.) will be rewritten
   * to use this base URL instead.
   * Example: If the session returns `http://internal-host:8080/jmap/` and
   * baseUrl is `http://localhost:8080`, URLs will be rewritten to use localhost.
   */
  readonly baseUrl?: string;
  /**
   * Origins besides that of `sessionUrl` (or of `baseUrl`, when set) that
   * the URLs of the Session may point to, such as
   * `https://api.mail.example.com`.  The transport sends its credentials to
   * those URLs, so a Session naming any other origin is refused.
   * @default []
   */
  readonly trustedOrigins?: readonly string[];
}
/**
 * Resolved JMAP configuration with all fields populated.
 */
export type ResolvedJmapConfig = {
  readonly sessionUrl: string;
  readonly bearerToken: string | null;
  readonly basicAuth: {
    readonly username: string;
    readonly password: string;
  } | null;
  readonly accountId: string | null;
  readonly identityId: string | null;
  readonly timeout: number;
  readonly retries: number;
  readonly headers: Record<string, string>;
  readonly sessionCacheTtl: number;
  readonly baseUrl: string | null;
  readonly trustedOrigins: readonly string[];
};
/**
 * Creates a resolved JMAP configuration with default values applied.
 * @param config The user-provided configuration.
 * @returns The resolved configuration with all fields populated.
 * @throws Error if neither bearerToken nor basicAuth is provided.
 */
export declare function createJmapConfig(config: JmapConfig): ResolvedJmapConfig;

/**
 * JMAP transport for sending emails via JMAP protocol (RFC 8620/8621).
 */
export declare class JmapTransport implements RawTransport<'jmap'>, VerifiableTransport<'jmap'> {
  readonly id = 'jmap';
  readonly config: ResolvedJmapConfig;
  /**
   * Creates a new JMAP transport instance.
   * @param config The JMAP transport configuration.
   */
  constructor(config: JmapConfig);
  /**
   * Checks a fresh Session, the account used by send(), its drafts mailbox,
   * and the configured or available identity without creating or sending mail.
   * Does not read or update the session cache. Each discovery operation has
   * config.timeout as its total budget, including response bodies and retries.
   * Success does not guarantee acceptance of a particular sender or message.
   * @param options Optional cancellation signal.
   * @returns A promise that resolves when live verification succeeds.
   * @throws {JmapApiError} If discovery, authentication, or validation fails.
   * @throws The caller's abort reason if cancelled.
   */
  verify(options?: TransportOptions): Promise<void>;
  /**
   * Sends a single email message.
   * @param message The message to send.
   * @param options Optional transport options.
   * @returns A receipt indicating success or failure.
   * @throws The abort reason or an `AbortError` when the caller aborts the
   *         operation.
   */
  send(message: Message, options?: TransportOptions): Promise<Receipt<'jmap'>>;
  /**
   * Uploads serialized MIME, imports it, and submits it with an explicit envelope.
   * JMAP servers may modify imported or submitted messages, including removing
   * Bcc. Import and submission are never retried automatically.
   * @param message Original MIME and delivery envelope.
   * @param options Optional cancellation signal.
   * @returns A receipt; uncertain submission outcomes are non-retryable.
   * @throws {Error} If cancellation is requested.
   */
  sendRaw(message: RawMessage, options?: TransportOptions): Promise<Receipt<'jmap'>>;
  /**
   * Sends multiple messages in a single batched JMAP request.
   * @param messages The messages to send.
   * @param options Optional transport options.
   * @yields Receipts for each message.
   * @throws The abort reason or an `AbortError` when the caller aborts the
   *         operation.
   */
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'jmap'>>;
}

/**
 * Error class for JMAP API errors.
 */
export declare class JmapApiError extends Error {
  readonly statusCode?: number;
  readonly responseBody?: string;
  readonly jmapErrorType?: string;
  readonly retryAfterMilliseconds?: number;
  readonly attempts?: number;
  constructor(
    message: string,
    statusCode?: number,
    responseBody?: string,
    jmapErrorType?: string,
    retryAfterMilliseconds?: number,
    attempts?: number,
    options?: { readonly cause?: unknown },
  );
}
/**
 * JMAP-specific error types from RFC 8620.
 */
export declare const JMAP_ERROR_TYPES: {
  readonly unknownCapability: 'urn:ietf:params:jmap:error:unknownCapability';
  readonly notJSON: 'urn:ietf:params:jmap:error:notJSON';
  readonly notRequest: 'urn:ietf:params:jmap:error:notRequest';
  readonly limit: 'urn:ietf:params:jmap:error:limit';
};
/**
 * Checks if the given error is a JMAP capability error.
 * @param error The error to check.
 * @returns `true` if the error is a JMAP capability error, `false` otherwise.
 */
export declare function isCapabilityError(error: unknown): boolean;

/**
 * JMAP Session response structure (RFC 8620 Section 2).
 */
export interface JmapSession {
  readonly capabilities: Record<string, unknown>;
  readonly accounts: Record<string, JmapAccount>;
  readonly primaryAccounts: Record<string, string>;
  readonly username: string;
  readonly apiUrl: string;
  readonly downloadUrl: string;
  readonly uploadUrl: string;
  readonly eventSourceUrl?: string;
  readonly state: string;
}
/**
 * JMAP Account structure from session response.
 */
export interface JmapAccount {
  readonly name: string;
  readonly isPersonal: boolean;
  readonly isReadOnly: boolean;
  readonly accountCapabilities: Record<string, unknown>;
}
/**
 * JMAP Identity object for sender authorization (RFC 8621 Section 6).
 */
export interface JmapIdentity {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly replyTo?: readonly {
    readonly email: string;
    readonly name?: string;
  }[];
  readonly bcc?: readonly {
    readonly email: string;
    readonly name?: string;
  }[];
  readonly textSignature?: string;
  readonly htmlSignature?: string;
  readonly mayDelete: boolean;
}
/**
 * Cached session data with metadata.
 */

/**
 * Response from a successful blob upload.
 */
export interface BlobUploadResponse {
  readonly accountId: string;
  readonly blobId: string;
  readonly type: string;
  readonly size: number;
}
/**
 * Upload a blob to the JMAP server.
 *
 * @param config - The resolved JMAP configuration
 * @param uploadUrl - The upload URL template from the session (e.g., "https://server/upload/{accountId}")
 * @param accountId - The account ID to upload to
 * @param blob - The blob or file to upload
 * @param signal - Optional abort signal
 * @returns The upload response containing the blobId
 */
export declare function uploadBlob(
  config: ResolvedJmapConfig,
  uploadUrl: string,
  accountId: string,
  blob: Blob | File,
  signal?: AbortSignal,
): Promise<BlobUploadResponse>;
