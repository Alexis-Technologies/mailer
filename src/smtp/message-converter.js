// Ported from upyo v0.7.0 (packages/smtp/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { prepareMimeMessage } = require('../mime/message.js');
const { refuseScheduledAt } = require('../internal/schedule.js');
const { hasNonAsciiAddress, resolveSmtpEnvelope } = require('./envelope.js');

/** Snapshots MIME metadata and preserves the effective SMTP envelope. */
const prepareMessage = (
  message,
  dkimConfig,
  dsn,
  resolvedEnvelope = resolveSmtpEnvelope(message),
  options = {},
) => {
  refuseScheduledAt(message, 'smtp');
  const plan = prepareMimeMessage(message, dkimConfig, options);
  const envelope = { ...resolvedEnvelope, dsn };
  return {
    ...plan,
    envelope,
    requiresSmtpUtf8: plan.encoding === 'utf8' || hasNonAsciiAddress(envelope),
  };
};
module.exports = { prepareMessage };
