// Ported from upyo v0.7.0 (packages/smtp/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { readAttachmentContent } = require('../core/attachment.js');
const { prepareMimeMessage } = require('../mime/message.js');
const { prepareMimeStream } = require('../mime/stream.js');
const { hasNonAsciiAddress, resolveSmtpEnvelope } = require('./envelope.js');

/** Snapshots MIME metadata and preserves the effective SMTP envelope. */
const prepareMessage = (
  message,
  dkimConfig,
  dsn,
  resolvedEnvelope = resolveSmtpEnvelope(message),
) => {
  const plan = prepareMimeMessage(message, dkimConfig);
  const envelope = { ...resolvedEnvelope, dsn };
  return {
    ...plan,
    envelope,
    requiresSmtpUtf8: plan.encoding === 'utf8' || hasNonAsciiAddress(envelope),
  };
};
/** Collects the shared stream using the historical internal trailing-CRLF convention. */
const convertMessage = async (
  message,
  dkimConfig,
  dsn,
  resolvedEnvelope = resolveSmtpEnvelope(message),
  signal,
) => {
  const plan = prepareMessage(message, dkimConfig, dsn, resolvedEnvelope);
  const stream = await prepareMimeStream(plan, { signal });
  // oxlint-disable-next-line no-shadow -- upstream
  const bytes = await readAttachmentContent((signal) => stream.read(signal), signal);
  return {
    envelope: plan.envelope,
    raw: new TextDecoder().decode(bytes).slice(0, -2),
    requiresSmtpUtf8: plan.requiresSmtpUtf8 || stream.encoding === 'utf8',
  };
};

module.exports = { prepareMessage, convertMessage };
