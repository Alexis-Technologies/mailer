// Types ported from upyo v0.7.0 (packages/smtp/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/// <reference lib="esnext.disposable" />

import type {
  EmailAddress,
  Message,
  RawMessage,
  RawTransport,
  Receipt,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';
import type { DkimConfig } from '../mime/index.js';

export type {
  DkimAlgorithm,
  DkimBodyMode,
  DkimCanonicalization,
  DkimConfig,
  DkimSignature,
  DkimSigningFailureAction,
} from '../mime/index.js';

/**
 * Configuration interface for SMTP transport connection settings.
 *
 * This interface defines all available options for configuring an SMTP
 * connection including server details, authentication, security, and
 * connection pooling settings.
 *
 * @example
 * ```typescript
 * const config: SmtpConfig = {
 *   host: 'smtp.gmail.com',
 *   port: 465,
 *   secure: true, // Use TLS from start
 *   auth: {
 *     user: 'user@gmail.com',
 *     pass: 'app-password'
 *   },
 *   connectionTimeout: 30000,
 *   poolSize: 10
 * };
 * ```
 */
export interface SmtpConfig extends TransportDependencies {
  /**
   * The SMTP server hostname or IP address.
   */
  readonly host: string;
  /**
   * The SMTP server port number.
   * @default 587
   */
  readonly port?: number;
  /**
   * Whether to use implicit TLS from the start of the connection.
   * @default `true` on port 465; otherwise `false`
   */
  readonly secure?: boolean;
  /**
   * Whether to require a successful STARTTLS upgrade for connections that do
   * not use implicit TLS.  When enabled, the client issues `STARTTLS` even if
   * the server does not advertise the capability and fails the connection if
   * the upgrade does not succeed.
   * @default false
   */
  readonly requireTls?: boolean;
  /**
   * Authentication configuration for the SMTP server.
   */
  readonly auth?: SmtpAuth;
  /**
   * TLS configuration options.
   */
  readonly tls?: SmtpTlsOptions;
  /**
   * Connection timeout in milliseconds.
   * @default 60000
   */
  readonly connectionTimeout?: number;
  /**
   * Socket timeout in milliseconds.
   * @default 60000
   */
  readonly socketTimeout?: number;
  /**
   * The name to use for the local hostname in the HELO/EHLO command.  By
   * default the host name of this machine when it is a fully qualified
   * domain name, its address as an address literal, or `[127.0.0.1]`, as
   * nodemailer gives it; a server that checks the name refuses `localhost`.
   */
  readonly localName?: string;
  /**
   * The local address to connect from, on a machine with several.
   */
  readonly localAddress?: string;
  /**
   * Opens the connection instead of a TCP connection to `host` and `port`:
   * through an HTTP proxy ({@link createHttpProxyConnector}), a SOCKS proxy
   * module of your own, or any tunnel.  It resolves to a connected socket to
   * the server, paused or with nothing read from it yet; `secure: true` and
   * STARTTLS put TLS over it as over a TCP connection.  It is given the
   * connection timeout and the caller's cancellation as `signal`.
   *
   * Plain-text authentication is allowed only when `host` itself is a
   * loopback host, whatever address the tunnel connects to.
   */
  readonly connect?: (options: SmtpConnectOptions) => SmtpSocket | Promise<SmtpSocket>;
  /**
   * Pool connections to reuse them.
   * @default true
   */
  readonly pool?: boolean;
  /**
   * Maximum number of SMTP connections the transport may have open at once.
   *
   * The limit counts every connection the transport owns: connections that are
   * being established, connections that are currently sending, and idle
   * connections retained for reuse.  It therefore applies whether or not
   * {@link SmtpConfig.pool} is enabled.  When the limit is reached, `send()`
   * `sendMany()`, `sendRaw()`, and `verify()` wait for a connection to become available instead of
   * opening another one, so this value can be matched to a provider's
   * simultaneous-connection limit.
   *
   * Must be a positive integer, or `Infinity` to leave the number of
   * connections unbounded.
   *
   * @default 5
   */
  readonly poolSize?: number;
  /**
   * The messages a connection sends before it is closed and a new one is
   * opened, as servers limit the messages of one connection (nodemailer's
   * `maxMessages`).  `sendMany()` opens a new connection within a batch.
   * `Infinity` for no limit.
   *
   * @default 100
   */
  readonly maxMessages?: number;
  /**
   * DKIM signing configuration.
   * When provided, all outgoing emails will be signed with DKIM.
   */
  readonly dkim?: DkimConfig;
}
/**
 * Authentication configuration for SMTP connections.
 *
 * This is a discriminated union of the supported authentication strategies:
 *
 *  -  {@link SmtpUserPassAuth}: traditional username/password authentication
 *     (SASL `PLAIN`, `LOGIN`, …), discriminated by the `pass` field.
 *  -  {@link SmtpOAuth2TokenAuth}: OAuth 2.0 authentication using a static or
 *     dynamically provided access token, discriminated by the `accessToken`
 *     field.
 *  -  {@link SmtpOAuth2RefreshAuth}: OAuth 2.0 authentication using the built-in
 *     `refresh_token` grant flow, discriminated by the `refreshToken` field.
 *
 * @example
 * ```typescript
 * // Username/password
 * const passwordAuth: SmtpAuth = {
 *   user: 'username@domain.com',
 *   pass: 'password',
 *   method: 'plain' // or 'login'
 * };
 *
 * // OAuth 2.0 with a (possibly refreshing) access token
 * const tokenAuth: SmtpAuth = {
 *   user: 'username@gmail.com',
 *   accessToken: 'ya29.a0Af…',
 *   method: 'xoauth2' // or 'oauthbearer'
 * };
 * ```
 */
export type SmtpAuth = SmtpUserPassAuth | SmtpOAuth2TokenAuth | SmtpOAuth2RefreshAuth;
/**
 * OAuth 2.0 access token aggregate that supplies access tokens on demand.
 *
 * The transport invokes the provider each time it needs to authenticate a new
 * connection, which lets the caller plug in an external OAuth client (e.g.,
 * `google-auth-library` or `msal-node`) and refresh expired tokens
 * transparently.
 *
 * @param signal An optional {@link AbortSignal} to cancel token acquisition.
 * @returns The OAuth 2.0 access token (bearer token), or a promise of it.
 */
export type OAuth2TokenProvider = (signal?: AbortSignal) => string | Promise<string>;
/**
 * Username/password authentication configuration for SMTP connections.
 *
 * Defines the credentials and SASL method to use when connecting to an SMTP
 * server that requires password-based authentication.
 *
 * @example
 * ```typescript
 * const auth: SmtpUserPassAuth = {
 *   user: 'username@domain.com',
 *   pass: 'password',
 *   method: 'plain' // or 'login'
 * };
 * ```
 */
export interface SmtpUserPassAuth {
  /**
   * Username for authentication.
   */
  readonly user: string;
  /**
   * Password for authentication.
   */
  readonly pass: string;
  /**
   * Authentication method.
   * @default "plain"
   */
  readonly method?: 'plain' | 'login';
}
/**
 * OAuth 2.0 authentication configuration using a directly supplied access
 * token.
 *
 * The `accessToken` may be a static string or an {@link OAuth2TokenProvider}
 * callback that returns a fresh token on demand.  Use the callback form to
 * integrate an external OAuth client (such as `google-auth-library` or
 * `msal-node`) so that expired tokens are refreshed automatically.
 *
 * @example
 * ```typescript
 * const auth: SmtpOAuth2TokenAuth = {
 *   user: 'username@gmail.com',
 *   accessToken: async () => await getFreshAccessToken(),
 *   method: 'xoauth2',
 * };
 * ```
 */
export interface SmtpOAuth2TokenAuth {
  /**
   * The user (email address) to authenticate as.
   */
  readonly user: string;
  /**
   * The OAuth 2.0 access token, or a provider callback returning one.
   *
   * When a callback is given, it is invoked every time a new connection is
   * authenticated, allowing the caller to refresh expired tokens.
   */
  readonly accessToken: string | OAuth2TokenProvider;
  /**
   * The SASL mechanism to use.  When omitted, the mechanism is chosen
   * automatically based on the server's advertised capabilities, preferring
   * `xoauth2`.
   * @default "xoauth2"
   */
  readonly method?: 'xoauth2' | 'oauthbearer';
}
/**
 * OAuth 2.0 authentication configuration using the built-in `refresh_token`
 * grant flow.
 *
 * The transport exchanges the refresh token for an access token at the given
 * token endpoint and caches it until shortly before it expires, refreshing it
 * automatically as needed.  No external OAuth library is required.
 *
 * @example
 * ```typescript
 * const auth: SmtpOAuth2RefreshAuth = {
 *   user: 'username@gmail.com',
 *   clientId: '…apps.googleusercontent.com',
 *   clientSecret: '…',
 *   refreshToken: '1//…',
 *   tokenEndpoint: 'https://oauth2.googleapis.com/token',
 * };
 * ```
 */
export interface SmtpOAuth2RefreshAuth {
  /**
   * The user (email address) to authenticate as.
   */
  readonly user: string;
  /**
   * The OAuth 2.0 client identifier.
   */
  readonly clientId: string;
  /**
   * The OAuth 2.0 client secret.  May be omitted for public clients (e.g.,
   * clients using PKCE) that have no secret.
   */
  readonly clientSecret?: string;
  /**
   * The OAuth 2.0 refresh token used to obtain access tokens.
   */
  readonly refreshToken: string;
  /**
   * The token endpoint URL where the refresh token is exchanged for an access
   * token (e.g., `https://oauth2.googleapis.com/token`).
   */
  readonly tokenEndpoint: string;
  /**
   * An optional space-delimited list of OAuth 2.0 scopes to request.
   */
  readonly scope?: string;
  /**
   * The SASL mechanism to use.  When omitted, the mechanism is chosen
   * automatically based on the server's advertised capabilities, preferring
   * `xoauth2`.
   * @default "xoauth2"
   */
  readonly method?: 'xoauth2' | 'oauthbearer';
}
/**
 * OAuth 2.0 authentication configuration for SMTP connections.
 *
 * A union of the OAuth 2.0 authentication strategies: a directly supplied
 * (or callback-provided) access token ({@link SmtpOAuth2TokenAuth}) or the
 * built-in `refresh_token` grant flow ({@link SmtpOAuth2RefreshAuth}).
 */
export type SmtpOAuth2Auth = SmtpOAuth2TokenAuth | SmtpOAuth2RefreshAuth;
/**
 * TLS/SSL configuration options for secure SMTP connections.
 *
 * These options control the behavior of TLS encryption when connecting
 * to SMTP servers, including certificate validation and client authentication.
 *
 * @example
 * ```typescript
 * const tlsOptions: SmtpTlsOptions = {
 *   rejectUnauthorized: true,
 *   minVersion: 'TLSv1.2',
 *   ca: [fs.readFileSync('ca-cert.pem', 'utf8')]
 * };
 * ```
 */
export interface SmtpTlsOptions {
  /**
   * Whether to reject unauthorized certificates.
   * @default true
   */
  readonly rejectUnauthorized?: boolean;
  /**
   * List of trusted certificates.
   */
  readonly ca?: string[];
  /**
   * Private key for client certificate authentication.
   */
  readonly key?: string;
  /**
   * Certificate for client certificate authentication.
   */
  readonly cert?: string;
  /**
   * Minimum TLS version to accept.
   * @default "TLSv1.2"
   */
  readonly minVersion?: 'TLSv1' | 'TLSv1.1' | 'TLSv1.2' | 'TLSv1.3';
  /**
   * Maximum TLS version to accept.
   * @default "TLSv1.3"
   */
  readonly maxVersion?: 'TLSv1' | 'TLSv1.1' | 'TLSv1.2' | 'TLSv1.3';
}
/**
 * Resolved SMTP configuration with all optional fields filled with default values.
 *
 * This type represents the final configuration after applying defaults,
 * used internally by the SMTP transport implementation.
 */

/**
 * Overrides for the SMTP envelope of one message.
 *
 * Omitted fields are derived from the corresponding message fields.  A `null`
 * sender produces the null reverse-path used for delivery notifications.
 */
export interface SmtpEnvelopeOptions {
  /**
   * The address for `MAIL FROM`, or `null` for `MAIL FROM:<>`.
   *
   * When omitted, the message sender is used.
   */
  readonly from?: EmailAddress | null;
  /**
   * The addresses for `RCPT TO`.
   *
   * When omitted, the message's To, Cc, and Bcc addresses are used.
   */
  readonly to?: readonly EmailAddress[];
}
/**
 * Resolves an SMTP envelope override for one message in a batch.
 *
 * @param message The message whose envelope is being resolved.
 * @param index The zero-based position of the message in the send operation.
 * @returns The envelope override, or `undefined` to derive the envelope from
 * the message.
 */
export type SmtpEnvelopeResolver = (
  message: Message,
  index: number,
) => SmtpEnvelopeOptions | undefined;
/**
 * Error produced when an effective SMTP envelope is invalid.
 */
export declare class SmtpEnvelopeValidationError extends TypeError {
  /**
   * Creates an SMTP envelope validation error.
   *
   * @param message A description of the invalid envelope.
   */
  constructor(message: string);
}
/** @internal */

/**
 * A condition under which an SMTP server should issue a delivery status
 * notification for a recipient.
 *
 * `"never"` must be the only condition when it is used.
 */
export type SmtpDsnNotification = 'never' | 'success' | 'failure' | 'delay';
/**
 * Delivery status notification settings for one SMTP envelope recipient.
 */
export interface SmtpDsnRecipientOptions {
  /**
   * Conditions under which the server should issue a notification.
   *
   * `"never"` must appear by itself.  When omitted, the server applies its
   * default behavior, which is normally equivalent to `"failure"` or to
   * `"failure"` together with `"delay"`.
   */
  readonly notify?: readonly SmtpDsnNotification[];
  /**
   * The original Internet mail address to identify in notifications.
   *
   * Upyo serializes this as an RFC 3461 `ORCPT` parameter with the `rfc822`
   * address type.  For an initial submission, RFC 3461 requires this value to
   * equal the corresponding envelope recipient address.
   */
  readonly originalRecipient?: string;
}
/**
 * SMTP delivery status notification settings for one message.
 *
 * These settings are serialized as SMTP envelope parameters and are not added
 * to the message headers.
 */
export interface SmtpDsnOptions {
  /**
   * An identifier that will be returned in delivery status notifications.
   * Serialized as the RFC 3461 `ENVID` parameter.  The identifier must not be
   * empty.
   */
  readonly envelopeId?: string;
  /**
   * How much of the original message a failure notification should return.
   * Serialized as `RET=FULL` or `RET=HDRS`.
   */
  readonly return?: 'full' | 'headers';
  /**
   * Per-recipient notification settings, keyed by exact envelope address.
   */
  readonly recipients?: Readonly<Record<string, SmtpDsnRecipientOptions>>;
}
/**
 * SMTP-specific options for sending messages.
 */
export interface SmtpTransportOptions extends TransportOptions {
  /**
   * SMTP envelope overrides for this send operation.
   *
   * A resolver can return a different envelope for each message passed to
   * {@link SmtpTransport.sendMany}.
   */
  readonly envelope?: SmtpEnvelopeOptions | SmtpEnvelopeResolver;
  /** Delivery status notification settings for this SMTP transaction. */
  readonly dsn?: SmtpDsnOptions;
}
/**
 * Error produced when SMTP delivery status notification settings are invalid.
 */
export declare class SmtpDsnValidationError extends TypeError {
  /**
   * Creates a delivery status notification validation error.
   *
   * @param message A description of the invalid setting.
   */
  constructor(message: string);
}
/**
 * Error produced when delivery status notifications were requested from an
 * SMTP server that did not advertise the RFC 3461 `DSN` extension.
 */
export declare class SmtpDsnUnsupportedError extends Error {
  /** Creates an error for a server without the `DSN` extension. */
  constructor();
}
/** @internal */

/** Options for raw SMTP delivery. @since 0.6.0 */
export interface SmtpRawTransportOptions extends TransportOptions {
  /** Optional delivery status notifications for the explicit raw envelope. */
  readonly dsn?: SmtpDsnOptions;
  /** The envelope must be specified on the raw message itself. */
  readonly envelope?: never;
}

/**
 * A machine-readable enhanced SMTP status code defined by RFC 3463.
 */
export interface SmtpEnhancedStatusCode {
  /** The complete enhanced status code. */
  readonly code: string;
  /** The delivery result class: success, transient failure, or permanent failure. */
  readonly class: 2 | 4 | 5;
  /** The subject identifying the probable source of the condition. */
  readonly subject: number;
  /** The detail identifying the precise condition. */
  readonly detail: number;
}
/**
 * An SMTP envelope recipient that the server rejected during an otherwise
 * successful delivery.
 */
export interface SmtpRejectedRecipient {
  /** The rejected recipient address. */
  readonly recipient: string;
  /** The three-digit SMTP reply code. */
  readonly code: number;
  /** The SMTP server's reply text. */
  readonly response: string;
  /** Whether retrying delivery to this recipient may succeed. */
  readonly retryable: boolean;
  /**
   * The enhanced status code returned for this recipient, when valid.
   */
  readonly enhancedStatusCode?: SmtpEnhancedStatusCode;
}
/**
 * Provider details for a failure returned by an SMTP server.
 */
export interface SmtpResponseProviderDetails {
  /** The SMTP command that failed. */
  readonly command: string;
  /** The text from the SMTP server's final reply line. */
  readonly response: string;
  /** Recipient-level failures collected for the transaction. */
  readonly rejectedRecipients?: readonly SmtpRejectedRecipient[];
  /** The enhanced status code in the server reply, when valid. */
  readonly enhancedStatusCode?: SmtpEnhancedStatusCode;
}
/**
 * Checks whether provider details came from an SMTP server response.
 *
 * @param value Provider details from an SMTP receipt error.
 * @returns Whether the value contains SMTP response details.
 */
export declare function isSmtpResponseProviderDetails(
  value: unknown,
): value is SmtpResponseProviderDetails;
/**
 * Provider details for a locally rejected oversized message.
 */
export interface SmtpMessageSizeProviderDetails {
  /** The encoded message size in octets. */
  readonly actualSize: number;
  /** The server's advertised maximum size in octets. */
  readonly maximumSize: string;
}
/**
 * Provider details for a missing internationalization capability.
 */
export interface SmtpUtf8ProviderDetails {
  /** The SMTP extension required by the message. */
  readonly missingCapability: 'SMTPUTF8' | '8BITMIME';
}
/**
 * Provider-specific details attached to SMTP receipt errors.
 */
export type SmtpProviderDetails =
  | SmtpResponseProviderDetails
  | SmtpMessageSizeProviderDetails
  | SmtpUtf8ProviderDetails;
/**
 * A receipt returned by {@link SmtpTransport}.
 *
 * Successful receipts list any recipients rejected before the message was
 * delivered to the remaining accepted recipients.  Callers can retry delivery
 * to entries marked as retryable without redelivering to accepted recipients.
 */
export type SmtpReceipt =
  | (Extract<
      Receipt<'smtp'>,
      {
        readonly successful: true;
      }
    > & {
      /** Recipients excluded from an otherwise successful delivery. */
      readonly rejectedRecipients: readonly SmtpRejectedRecipient[];
    })
  | Extract<
      Receipt<'smtp'>,
      {
        readonly successful: false;
      }
    >;

/**
 * SMTP transport implementation for sending emails via SMTP protocol.
 *
 * This transport provides efficient email delivery with connection pooling,
 * support for authentication, TLS/SSL encryption, and batch sending capabilities.
 *
 * @example
 * ```typescript
 * import { SmtpTransport } from '@alexify/mailer/smtp';
 *
 * // Automatic resource cleanup with using statement
 * await using transport = new SmtpTransport({
 *   host: 'smtp.gmail.com',
 *   port: 465,
 *   secure: true, // Use TLS from start
 *   auth: {
 *     user: 'user@gmail.com',
 *     pass: 'app-password'
 *   }
 * });
 *
 * const receipt = await transport.send(message);
 * // Connections are automatically closed here
 *
 * // Or manual management
 * const transport2 = new SmtpTransport(config);
 * try {
 *   await transport2.send(message);
 * } finally {
 *   await transport2.closeAllConnections();
 * }
 * ```
 */
/**
 * What the `connect` of {@link SmtpConfig} is given.
 */
export interface SmtpConnectOptions {
  /** The SMTP server to reach. */
  readonly host: string;
  /** Its port. */
  readonly port: number;
  /** The `localAddress` of the configuration, if any. */
  readonly localAddress?: string;
  /** Aborts on the connection timeout and on the caller's cancellation. */
  readonly signal: AbortSignal;
}
/**
 * A connected socket: a `net.Socket` of Node.js, or a duplex stream with its
 * methods.
 */
export interface SmtpSocket {
  write(chunk: any, ...rest: any[]): boolean;
  setTimeout(timeout: number, callback?: () => void): unknown;
  destroy(error?: Error): unknown;
  on(event: string, listener: (...args: any[]) => void): unknown;
}
/**
 * Options of {@link createHttpProxyConnector}.
 */
export interface HttpProxyConnectorOptions {
  /**
   * The proxy, `http://` or `https://`, with the user name and password of
   * its Basic authentication if it asks for one:
   * `http://user:pass@proxy.example.com:3128`.
   */
  readonly url: string;
  /** Header fields to add to each CONNECT request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** TLS options of an `https://` proxy, such as its `ca`. */
  readonly tls?: SmtpTlsOptions;
  /**
   * The time the proxy may take to answer CONNECT, in milliseconds; 0 or
   * `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
}
/**
 * Makes a `connect` for {@link SmtpConfig} that opens each connection through
 * an HTTP or HTTPS proxy with CONNECT.
 *
 * @example
 * ```js
 * const { SmtpTransport, createHttpProxyConnector } = require('@alexify/mailer/smtp');
 * const transport = new SmtpTransport({
 *   host: 'smtp.example.com',
 *   port: 465,
 *   auth: { user, pass },
 *   connect: createHttpProxyConnector({ url: 'http://proxy.internal:3128' }),
 * });
 * ```
 */
export declare function createHttpProxyConnector(
  options: HttpProxyConnectorOptions,
): (options: SmtpConnectOptions) => Promise<SmtpSocket>;
export declare class SmtpTransport
  implements RawTransport<'smtp'>, VerifiableTransport<'smtp'>, AsyncDisposable
{
  readonly id = 'smtp';
  /**
   * The SMTP configuration used by this transport.
   */
  config: SmtpConfig;
  /**
   * The maximum number of SMTP connections this transport may have open at
   * once.  The limit covers connections that are being established,
   * connections that are currently sending, and idle connections retained for
   * reuse, so it holds whether or not pooling is enabled.  A caller that needs
   * a connection while the limit is reached waits until one becomes available.
   * `Infinity` leaves the number of connections unbounded.
   */
  poolSize: number;
  /**
   * Creates a new SMTP transport instance.
   *
   * @param config SMTP configuration including server details, authentication,
   *               and options.
   * @throws {RangeError} If `config.poolSize` is neither a positive integer nor
   *                        `Infinity`.
   */
  constructor(config: SmtpConfig);
  /**
   * Checks a fresh SMTP connection, TLS policy, and configured authentication
   * without sending mail. Uses the shared connection limit and closes the
   * verification connection afterward, even when pooling is enabled.
   * Success does not guarantee acceptance of a sender, recipient, or message.
   * @param options Optional cancellation signal, including while waiting for capacity.
   * @returns A promise that resolves after successful verification and cleanup.
   * @throws {SmtpResponseError} If greeting, EHLO/HELO, or STARTTLS is rejected.
   * @throws {SmtpAuthError} If authentication fails.
   * @throws {Error} If a connection, TLS, or timeout error occurs.
   * @throws The caller's abort reason if cancelled.
   */
  verify(options?: TransportOptions): Promise<void>;
  /**
   * Sends a single email message via SMTP.
   *
   * This method converts the message to SMTP format, establishes a connection
   * to the SMTP server, sends the message, and returns a receipt with the result.
   *
   * @example
   * ```typescript
   * const receipt = await transport.send({
   *   sender: { address: 'from@example.com' },
   *   recipients: [{ address: 'to@example.com' }],
   *   subject: 'Hello',
   *   content: { text: 'Hello World!' }
   * });
   *
   * if (receipt.successful) {
   *   console.log('Message sent with ID:', receipt.messageId);
   * }
   * ```
   *
   * @param message The email message to send.
   * @param options Optional SMTP envelope, delivery status, and cancellation
   *                settings.
   * @returns A promise that resolves to a receipt indicating success or
   *          failure.
   * @throws {DOMException} If the operation is aborted through
   *                        `options.signal`.
   */
  send(message: Message, options?: SmtpTransportOptions): Promise<SmtpReceipt>;
  /**
   * Delivers serialized MIME unchanged, apart from SMTP dot-stuffing.
   * Configured DKIM signing and message composition are bypassed.
   * @param message Original MIME bytes and explicit delivery envelope.
   * @param options Optional DSN and cancellation settings.
   * @returns An SMTP receipt, including any rejected recipients.
   * @throws {Error} If cancellation is requested.
   */
  sendRaw(message: RawMessage, options?: SmtpRawTransportOptions): Promise<SmtpReceipt>;
  /**
   * Sends multiple email messages efficiently using a single SMTP connection.
   *
   * This method is optimized for bulk email sending by reusing a single SMTP
   * connection for all messages, which significantly improves performance
   * compared to sending each message individually.
   *
   * @example
   * ```typescript
   * const messages = [
   *   { subject: 'Message 1', recipients: [{ address: 'user1@example.com' }], ... },
   *   { subject: 'Message 2', recipients: [{ address: 'user2@example.com' }], ... }
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
   * @param options Optional SMTP envelope, delivery status, and cancellation
   *                settings.
   * @returns An async iterable of receipts, one for each message.
   * @throws {DOMException} If the operation is aborted through
   *                        `options.signal`.
   */
  sendMany(
    messages: Iterable<Message> | AsyncIterable<Message>,
    options?: SmtpTransportOptions,
  ): AsyncIterable<SmtpReceipt>;
  /**
   * Closes idle connections and drains sends and verification admitted before
   * this call.
   *
   * Resolves once those sends have released their connections and all their
   * sockets have closed.  Delivery is not interrupted, including sends waiting
   * for capacity or connection setup.  A started `sendMany()` iteration must
   * finish or be returned by its consumer before shutdown can complete.
   *
   * Concurrent close calls share the shutdown. New sends and verification wait for it to
   * finish (and can cancel that wait through their abort signal); the transport
   * can be reused afterward.
   *
   * @returns A promise that resolves after the admitted work is drained.
   *
   * @example
   * ```typescript
   * // At application shutdown
   * await transport.closeAllConnections();
   * ```
   */
  closeAllConnections(): Promise<void>;
  /**
   * Implements AsyncDisposable interface for automatic resource cleanup.
   *
   * This method is called automatically when using the `using` keyword,
   * ensuring that all SMTP connections are properly closed when the
   * transport goes out of scope.  Like {@link closeAllConnections}, it waits
   * for admitted sends and started batch iterations to release their connections.
   *
   * @example
   * ```typescript
   * // Automatic cleanup with using statement
   * await using transport = new SmtpTransport(config);
   * await transport.send(message);
   * // Connections are automatically closed here
   * ```
   */
  [Symbol.asyncDispose](): Promise<void>;
}

/** A replayable attachment changed between DKIM body reads. @since 0.6.0 */
export declare class SmtpAttachmentReplayError extends TypeError {
  /** Creates a replay validation failure. */
  constructor();
}
/** The final bytes and known size of an SMTP DATA transaction. */

/** Missing support for explicitly declared 8-bit MIME bodies. @since 0.6.0 */
export declare class Smtp8BitMimeUnsupportedError extends TypeError {
  /** Creates an error for a server without 8BITMIME. */
  constructor();
}
/** @internal */

/**
 * An error thrown when SMTP authentication fails, including OAuth 2.0 token
 * acquisition and SASL exchange failures.
 */
export declare class SmtpAuthError extends Error {
  /**
   * Creates a new {@link SmtpAuthError}.
   * @param message A human-readable description of the failure.
   */
  constructor(message: string);
}
/**
 * Builds the SASL `XOAUTH2` initial client response for SMTP authentication.
 *
 * The unencoded payload follows Google's XOAUTH2 format
 * (`user=<user>^Aauth=Bearer <token>^A^A`, where `^A` is the `0x01` control
 * character) and is returned Base64-encoded, ready to be sent as the argument
 * of `AUTH XOAUTH2`.
 *
 * @param user The user (email address) to authenticate as.
 * @param accessToken The OAuth 2.0 access token.
 * @returns The Base64-encoded XOAUTH2 initial client response.
 */

/**
 * An authentication failure backed by an SMTP server reply.
 *
 * This keeps {@link SmtpAuthError} as the public authentication error while
 * retaining the reply fields needed to build structured transport receipts.
 */
export declare class SmtpAuthResponseError extends SmtpAuthError {
  /** The numeric SMTP reply code returned by the server. */
  readonly code: number;
  /** The authentication command that produced the reply. */
  readonly command: string;
  /** The textual SMTP reply returned by the server. */
  readonly response: string;
  /**
   * Creates an authentication response error.
   *
   * @param message A human-readable description of the authentication failure.
   * @param code The numeric SMTP reply code.
   * @param command The authentication command that produced the reply.
   * @param response The textual SMTP reply returned by the server.
   */
  constructor(message: string, code: number, command: string, response: string);
}
/**
 * Error thrown when an SMTP command receives an unsuccessful server reply.
 */
export declare class SmtpResponseError extends Error {
  /**
   * The numeric SMTP reply code returned by the server.
   */
  readonly code: number;
  /**
   * The SMTP command that produced the reply.
   */
  readonly command: string;
  /**
   * The textual SMTP reply returned by the server.
   */
  readonly response: string;
  /** Recipient-level failures collected for an unsuccessful transaction. */
  readonly rejectedRecipients?: readonly SmtpRejectedRecipient[];
  /**
   * Creates an SMTP response error.
   *
   * @param message Human-readable error message.
   * @param code The numeric SMTP reply code.
   * @param command The SMTP command that produced the reply.
   * @param response The textual SMTP reply returned by the server.
   * @param rejectedRecipients Recipient-level failures collected for the
   *                           transaction.
   */
  constructor(
    message: string,
    code: number,
    command: string,
    response: string,
    rejectedRecipients?: readonly SmtpRejectedRecipient[],
  );
}
