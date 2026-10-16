// Ported from upyo v0.7.0 (packages/mime/src/dkim/types.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Validates the runtime body-mode option without changing config identity.
 * @param config Optional signing configuration.
 * @throws {TypeError} If the body mode is unsupported.
 */
const validateDkimBodyMode = (config) => {
  if (
    config?.bodyMode !== undefined &&
    config.bodyMode !== 'buffered' &&
    config.bodyMode !== 'streaming'
  ) {
    throw new TypeError('Expected DKIM bodyMode to be buffered or streaming.');
  }
};

/**
 * Default header fields to sign if not specified: those a reader trusts or a
 * client renders, present or not, since a field absent when signed cannot be
 * added afterwards without breaking the signature.  From, Reply-To and
 * Subject are listed once more than they can appear, so that a second
 * instance cannot be added either (over-signing, RFC 6376 §8.15).
 */
const DEFAULT_SIGNED_HEADERS = [
  'from',
  'from',
  'reply-to',
  'reply-to',
  'subject',
  'subject',
  'to',
  'cc',
  'date',
  'message-id',
  'in-reply-to',
  'references',
  'mime-version',
  'content-type',
];

/**
 * Default DKIM algorithm.
 */
const DEFAULT_ALGORITHM = 'rsa-sha256';

/**
 * Default canonicalization method.
 */
const DEFAULT_CANONICALIZATION = 'relaxed/relaxed';

module.exports = {
  validateDkimBodyMode,
  DEFAULT_SIGNED_HEADERS,
  DEFAULT_ALGORITHM,
  DEFAULT_CANONICALIZATION,
};
