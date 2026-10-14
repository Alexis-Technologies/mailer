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
 * Default header fields to sign if not specified.
 */
const DEFAULT_SIGNED_HEADERS = ['from', 'to', 'subject', 'date'];

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
