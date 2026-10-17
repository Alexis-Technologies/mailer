// Ported from upyo v0.7.0 (packages/smtp/src/message-converter.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee
//
// A message composed whole into a string, with the envelope SMTP would use.
// The transport streams a message instead, so this left src/ after the port;
// the tests read composed messages through it.

const { readAttachmentContent } = require('../../../src/core/attachment.js');
const { prepareMimeStream } = require('../../../src/mime/stream.js');
const { resolveSmtpEnvelope } = require('../../../src/smtp/envelope.js');
const { prepareMessage } = require('../../../src/smtp/message-converter.js');

const convertMessage = async (
  message,
  dkimConfig,
  dsn,
  resolvedEnvelope = resolveSmtpEnvelope(message),
  signal,
) => {
  const plan = prepareMessage(message, dkimConfig, dsn, resolvedEnvelope);
  const stream = await prepareMimeStream(plan, { signal });
  const bytes = await readAttachmentContent((readSignal) => stream.read(readSignal), signal);
  return {
    envelope: plan.envelope,
    raw: new TextDecoder().decode(bytes).slice(0, -2),
    requiresSmtpUtf8: plan.requiresSmtpUtf8 || stream.encoding === 'utf8',
  };
};

module.exports = { convertMessage };
