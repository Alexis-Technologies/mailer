// Types ported from upyo v0.7.0 (packages/mime/src)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

import type { Message, RawMessage, RawMessageValidationError } from '../../index.js';

/** Composition and lifetime options. @since 0.6.0 */
export interface ComposeMessageOptions {
  /** Optional DKIM signing; buffered body mode is the default. */
  readonly dkim?: DkimConfig;
  /** Cancels preparation and every future content reader. */
  readonly signal?: AbortSignal;
}
/** Stable, replayable MIME bytes with a separate delivery envelope. @since 0.6.0 */
export interface ComposedMessage extends RawMessage {
  /** MIME encoding requirement, independent of internationalized envelope addresses. */
  readonly encoding: '7bit' | 'utf8';
  /** Opens an independent reader. The signal cancels only this reader. */
  readonly content: (signal?: AbortSignal) => AsyncIterable<Uint8Array>;
}
/**
 * Composes complete MIME bytes without SMTP framing or a Bcc header.
 * Unsigned messages read attachments lazily. DKIM reads the body during
 * preparation; streaming mode reads it again and verifies every replay.
 * Metadata is snapshotted before asynchronous work. Keep attachment bytes
 * immutable and provide independent, identical factory readers.
 * @param message The structured message to serialize.
 * @param options Signing and cancellation options.
 * @returns Replayable bytes accepted by raw-message transports.
 * @throws {RawMessageValidationError} If the derived envelope is invalid.
 * @throws {TypeError} If message metadata or signing configuration is invalid.
 * @throws {RangeError} If a MIME header exceeds the hard line-length limit.
 * @throws {Error} If signing, attachment reading, or cancellation fails.
 * Attachment errors can also occur during later content reads, after partial
 * output. Streaming DKIM changes throw {@link MimeAttachmentReplayError}.
 */
export declare function composeMessage(
  message: Message,
  options?: ComposeMessageOptions,
): Promise<ComposedMessage>;

/**
 * A replayable attachment changed between DKIM body reads.
 */
export declare class MimeAttachmentReplayError extends RawMessageValidationError {
  /** Creates a replay validation failure. */
  constructor();
}

/**
 * Supported DKIM signing algorithms.
 *
 * - `rsa-sha256`: RSA with SHA-256, most widely used (RFC 6376)
 * - `ed25519-sha256`: Ed25519 with SHA-256, shorter keys (RFC 8463)
 */
export type DkimAlgorithm = 'rsa-sha256' | 'ed25519-sha256';
/**
 * DKIM canonicalization methods for header and body.
 *
 * Format: "header-method/body-method"
 *
 * - `simple`: No modifications (preserves exact content)
 * - `relaxed`: Normalizes whitespace and case
 *
 * @see RFC 6376 Section 3.4
 */
export type DkimCanonicalization =
  | 'relaxed/relaxed'
  | 'relaxed/simple'
  | 'simple/relaxed'
  | 'simple/simple';
/**
 * Configuration for a single DKIM signature.
 *
 * Each signature represents one DKIM-Signature header that will be added
 * to the email. Multiple signatures can be used for different domains
 * or selectors.
 */
export interface DkimSignature {
  /**
   * The domain name for the DKIM key (d= tag).
   * This is the domain claiming responsibility for the message.
   */
  readonly signingDomain: string;
  /**
   * The DKIM selector (s= tag).
   * Used to locate the public key in DNS: `selector._domainkey.signingDomain`
   */
  readonly selector: string;
  /**
   * The private key for signing.
   *
   * Can be either:
   * - A PEM-encoded private key string (PKCS#8 format)
   * - A `CryptoKey` object from Web Crypto API
   *
   * For RSA keys, use PKCS#8 PEM format or import via `crypto.subtle.importKey`.
   * For Ed25519 keys, use PKCS#8 PEM format or import via `crypto.subtle.importKey`.
   */
  readonly privateKey: string | CryptoKey;
  /**
   * The signing algorithm (a= tag).
   * @default "rsa-sha256"
   */
  readonly algorithm?: DkimAlgorithm;
  /**
   * The canonicalization method for header and body (c= tag).
   * @default "relaxed/relaxed"
   */
  readonly canonicalization?: DkimCanonicalization;
  /**
   * Header fields to include in the signature (h= tag).
   * @default ["from", "to", "subject", "date"]
   */
  readonly headerFields?: readonly string[];
}
/**
 * Action to take when DKIM signing fails.
 *
 * - `throw`: Throw an error and abort sending (default)
 * - `send-unsigned`: Log a warning and send the email without DKIM signature
 */
export type DkimSigningFailureAction = 'throw' | 'send-unsigned';
/**
 * Whether signing buffers the MIME body once or reads replayable sources twice.
 */
export type DkimBodyMode = 'buffered' | 'streaming';
/**
 * Configuration for DKIM signing in SMTP transport.
 */
export interface DkimConfig {
  /**
   * Body processing strategy. Streaming uses bounded attachment memory but
   * requires a second source read; buffered reads once and retains all MIME.
   * @default "buffered"
   */
  readonly bodyMode?: DkimBodyMode;
  /**
   * Array of DKIM signature configurations.
   * Each configuration will result in one DKIM-Signature header.
   */
  readonly signatures: readonly DkimSignature[];
  /**
   * Action to take when DKIM signing fails.
   * @default "throw"
   */
  readonly onSigningFailure?: DkimSigningFailureAction;
}
/**
 * Default header fields to sign if not specified.
 */
