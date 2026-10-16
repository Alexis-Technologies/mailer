// Ported from upyo v0.7.0 (packages/smtp/src/delivery-status.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/**
 * Error produced when SMTP delivery status notification settings are invalid.
 */
class SmtpDsnValidationError extends TypeError {
  /**
   * Creates a delivery status notification validation error.
   *
   * @param message A description of the invalid setting.
   */
  constructor(message) {
    super(message);
    this.name = 'SmtpDsnValidationError';
  }
}

/**
 * Error produced when delivery status notifications were requested from an
 * SMTP server that did not advertise the RFC 3461 `DSN` extension.
 */
class SmtpDsnUnsupportedError extends Error {
  /** Creates an error for a server without the `DSN` extension. */
  constructor() {
    super(
      'Delivery status notifications were requested, but the server does ' +
        'not advertise the DSN extension.',
    );
    this.name = 'SmtpDsnUnsupportedError';
  }
}

const NOTIFICATION_CONDITIONS = new Set(['never', 'success', 'failure', 'delay']);

/**
 * Validates and serializes the RFC 3461 envelope parameters for a message.
 *
 * @param envelope The effective SMTP envelope that will carry the parameters.
 * @param dsn The caller-supplied delivery status notification settings.
 * @returns Serialized parameters, or `undefined` when none were requested.
 * @throws {SmtpDsnValidationError} If any setting violates RFC 3461 or does
 * not correspond to the message envelope.
 * @internal
 */
const resolveSmtpDsn = (envelope, dsn) => {
  if (dsn == null) return undefined;
  if (typeof dsn !== 'object' || Array.isArray(dsn)) {
    throw new SmtpDsnValidationError('DSN options must be an object.');
  }
  const mailParameters = dsnMailParameters(dsn);
  const configuredRecipients = dsn.recipients;
  if (
    configuredRecipients != null &&
    (typeof configuredRecipients !== 'object' || Array.isArray(configuredRecipients))
  ) {
    throw new SmtpDsnValidationError('DSN recipient options must be an object.');
  }

  const envelopeRecipients = new Set(envelope.to);
  const serializedByAddress = new Map();
  for (const address in configuredRecipients) {
    if (!Object.hasOwn(configuredRecipients, address)) continue;
    if (!envelopeRecipients.has(address)) {
      throw new SmtpDsnValidationError(`DSN recipient ${address} is not an envelope recipient.`);
    }
    serializedByAddress.set(
      address,
      dsnRecipientParameters(address, configuredRecipients[address]),
    );
  }

  const recipientParameters = [];
  let requested = mailParameters.length > 0;
  for (const address of envelope.to) {
    const parameters = serializedByAddress.get(address) ?? [];
    if (parameters.length > 0) requested = true;
    recipientParameters.push(parameters);
  }
  return requested ? { mailParameters, recipientParameters } : undefined;
};

// RET and ENVID, the parameters of MAIL FROM (RFC 3461 §4.3 and §4.4).
const dsnMailParameters = (dsn) => {
  const parameters = [];
  if (dsn.return != null) {
    if (dsn.return !== 'full' && dsn.return !== 'headers') {
      throw new SmtpDsnValidationError(`Unsupported DSN return value: ${String(dsn.return)}`);
    }
    parameters.push(`RET=${dsn.return === 'full' ? 'FULL' : 'HDRS'}`);
  }
  if (dsn.envelopeId != null) {
    if (dsn.envelopeId === '') {
      throw new SmtpDsnValidationError('DSN envelope ID must not be empty.');
    }
    const parameter = `ENVID=${encodeXtext(dsn.envelopeId, 'DSN envelope ID')}`;
    assertParameterLength(parameter, 100, 'ENVID');
    parameters.push(parameter);
  }
  return parameters;
};

// NOTIFY and ORCPT, the parameters of a RCPT TO (RFC 3461 §4.1 and §4.2).
const dsnRecipientParameters = (address, options) => {
  if (options == null || typeof options !== 'object' || Array.isArray(options)) {
    throw new SmtpDsnValidationError(`DSN options for ${address} must be an object.`);
  }
  const parameters = [];
  if (options.notify != null) parameters.push(notifyParameter(address, options.notify));
  if (options.originalRecipient != null) {
    const encoded = encodeXtext(options.originalRecipient, `DSN original recipient for ${address}`);
    if (options.originalRecipient !== address) {
      throw new SmtpDsnValidationError(
        `DSN original recipient for ${address} must match the envelope recipient address.`,
      );
    }
    const parameter = `ORCPT=rfc822;${encoded}`;
    assertParameterLength(parameter, 500, 'ORCPT');
    parameters.push(parameter);
  }
  return parameters;
};

// The conditions of NOTIFY, checked and upper-cased in one pass.
const notifyParameter = (address, notify) => {
  if (!Array.isArray(notify) || notify.length === 0) {
    throw new SmtpDsnValidationError(
      `DSN notification conditions for ${address} must be a non-empty array.`,
    );
  }
  let conditions = '';
  let never = false;
  for (const condition of notify) {
    if (typeof condition !== 'string' || !NOTIFICATION_CONDITIONS.has(condition)) {
      throw new SmtpDsnValidationError(
        `Unsupported DSN notification condition: ${String(condition)}`,
      );
    }
    if (condition === 'never') never = true;
    conditions += `${conditions === '' ? '' : ','}${condition.toUpperCase()}`;
  }
  if (never && notify.length !== 1) {
    throw new SmtpDsnValidationError('The DSN notification condition NEVER must appear by itself.');
  }
  return `NOTIFY=${conditions}`;
};

const encodeXtext = (value, name) => {
  if (typeof value !== 'string') {
    throw new SmtpDsnValidationError(`${name} must be a string.`);
  }

  let encoded = '';
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) {
      throw new SmtpDsnValidationError(`${name} must contain only printable US-ASCII characters.`);
    }
    if (code >= 0x21 && code <= 0x7e && code !== 0x2b && code !== 0x3d) {
      encoded += value[index];
    } else {
      encoded += `+${code.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return encoded;
};

const assertParameterLength = (parameter, maximum, name) => {
  if (parameter.length > maximum) {
    throw new SmtpDsnValidationError(
      `${name} parameter exceeds the RFC 3461 limit of ${maximum} characters.`,
    );
  }
};

module.exports = { SmtpDsnValidationError, SmtpDsnUnsupportedError, resolveSmtpDsn };
