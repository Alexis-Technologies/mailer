// Ported from upyo v0.7.0 (packages/jmap/src/errors.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Error class for JMAP API errors.
 */
class JmapApiError extends Error {
  statusCode;
  responseBody;
  jmapErrorType;
  retryAfterMilliseconds;
  attempts;

  constructor(message, statusCode, responseBody, jmapErrorType, retryAfterMilliseconds, attempts) {
    super(message);
    this.name = 'JmapApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    this.jmapErrorType = jmapErrorType;
    this.retryAfterMilliseconds = retryAfterMilliseconds;
    this.attempts = attempts;
  }
}

/**
 * JMAP-specific error types from RFC 8620.
 */
const JMAP_ERROR_TYPES = {
  unknownCapability: 'urn:ietf:params:jmap:error:unknownCapability',
  notJSON: 'urn:ietf:params:jmap:error:notJSON',
  notRequest: 'urn:ietf:params:jmap:error:notRequest',
  limit: 'urn:ietf:params:jmap:error:limit',
};

/**
 * Checks if the given error is a JMAP capability error.
 * @param error The error to check.
 * @returns `true` if the error is a JMAP capability error, `false` otherwise.
 */
const isCapabilityError = (error) => {
  return (
    error instanceof JmapApiError && error.jmapErrorType === JMAP_ERROR_TYPES.unknownCapability
  );
};

module.exports = { JmapApiError, JMAP_ERROR_TYPES, isCapabilityError };
