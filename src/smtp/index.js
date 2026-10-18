// Ported from upyo v0.7.0 (packages/smtp/src/index.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { SmtpTransport } = require('./smtp-transport.js');
const { SmtpAuthResponseError, SmtpResponseError } = require('./smtp-connection.js');

const { SmtpAuthError } = require('./oauth2.js');
const { SmtpEnvelopeValidationError } = require('./envelope.js');

const { SmtpDsnUnsupportedError, SmtpDsnValidationError } = require('./delivery-status.js');
const { isSmtpResponseProviderDetails } = require('./smtp-receipt.js');

const { SmtpAttachmentReplayError } = require('./message-stream.js');
const { Smtp8BitMimeUnsupportedError } = require('./raw-message.js');
const { createHttpProxyConnector } = require('./http-proxy.js');

module.exports = {
  SmtpTransport,
  SmtpAuthResponseError,
  SmtpResponseError,
  SmtpAuthError,
  SmtpEnvelopeValidationError,
  SmtpDsnUnsupportedError,
  SmtpDsnValidationError,
  isSmtpResponseProviderDetails,
  SmtpAttachmentReplayError,
  Smtp8BitMimeUnsupportedError,
  createHttpProxyConnector,
};
