// Ported from upyo v0.7.0 (packages/smtp/src/envelope.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { isEmailAddress } = require('../core/address.js');

/**
 * Error produced when an effective SMTP envelope is invalid.
 */
class SmtpEnvelopeValidationError extends TypeError {
  /**
   * Creates an SMTP envelope validation error.
   *
   * @param message A description of the invalid envelope.
   */
  constructor(message) {
    super(message);
    this.name = 'SmtpEnvelopeValidationError';
  }
}

/**
 * Resolves and validates the SMTP envelope for a message.
 *
 * @param message The message that supplies fields without an override.
 * @param override Optional sender and recipient overrides.
 * @returns The validated effective SMTP envelope.
 * @throws {SmtpEnvelopeValidationError} If the override or any effective
 * address is invalid, or if the effective recipient list is empty.
 * @internal
 */
const resolveSmtpEnvelope = (message, override) => {
  if (
    override !== undefined &&
    (override === null || typeof override !== 'object' || Array.isArray(override))
  ) {
    throw new SmtpEnvelopeValidationError('SMTP envelope options must be an object.');
  }

  const from = override?.from === undefined ? message.sender.address : override.from;
  if (from !== null && !isEmailAddress(from)) {
    throw new SmtpEnvelopeValidationError(
      'SMTP envelope sender must be a valid email address or null.',
    );
  }

  const recipients =
    override?.to === undefined
      ? [
          ...message.recipients.map((recipient) => recipient.address),
          ...message.ccRecipients.map((recipient) => recipient.address),
          ...message.bccRecipients.map((recipient) => recipient.address),
        ]
      : override.to;
  if (!Array.isArray(recipients)) {
    throw new SmtpEnvelopeValidationError('SMTP envelope recipients must be an array.');
  }
  if (recipients.length === 0) {
    throw new SmtpEnvelopeValidationError('SMTP envelope must contain at least one recipient.');
  }

  for (const [index, recipient] of recipients.entries()) {
    if (!isEmailAddress(recipient)) {
      throw new SmtpEnvelopeValidationError(
        `SMTP envelope recipient at index ${index} must be a valid email address.`,
      );
    }
  }

  return { from, to: [...recipients] };
};

/**
 * Checks a path right before it goes between the angle brackets of `MAIL FROM`
 * or `RCPT TO`, whatever validated it before: outside a quoted local part it
 * may hold no "<", ">", space or control character, any of which would end
 * the path and let the rest of the address pass as ESMTP parameters.
 *
 * @param path The reverse- or forward-path, `''` for the null sender.
 * @throws {SmtpEnvelopeValidationError} If the path could end the command's
 * path early.
 * @internal
 */
const checkSmtpPath = (path) => {
  let isQuoted = path.charCodeAt(0) === 0x22;
  let isEscaped = false;
  for (let i = isQuoted ? 1 : 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    const isControl = code < 0x20 || code === 0x7f;
    const endsPath = !isQuoted && (code === 0x20 || code === 0x3c || code === 0x3e);
    if (isControl || endsPath) {
      throw new SmtpEnvelopeValidationError(
        'SMTP envelope address must not contain "<", ">", a space or a control character.',
      );
    }
    if (isEscaped) isEscaped = false;
    else if (isQuoted && code === 0x5c) isEscaped = true;
    else if (isQuoted && code === 0x22) isQuoted = false;
  }
};

module.exports = { SmtpEnvelopeValidationError, checkSmtpPath, resolveSmtpEnvelope };
