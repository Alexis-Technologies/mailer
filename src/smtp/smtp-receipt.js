// Ported from upyo v0.7.0 (packages/smtp/src/smtp-receipt.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Checks whether provider details came from an SMTP server response.
 *
 * @param value Provider details from an SMTP receipt error.
 * @returns Whether the value contains SMTP response details.
 */
const isSmtpResponseProviderDetails = (value) => {
  return (
    value != null &&
    typeof value === 'object' &&
    'command' in value &&
    typeof value.command === 'string' &&
    'response' in value &&
    typeof value.response === 'string'
  );
};

module.exports = { isSmtpResponseProviderDetails };
