// A message for SmtpConnection.sendMessage() from a raw string, the form the
// ported connection tests write their messages in.  It goes through the path of
// sendRaw(), with the trailing CRLF the connection used to add to such a string
// itself before the form left src/.

const { createRawMessagePlan } = require('../../../src/core/raw-message.js');

const rawSmtpMessage = ({ envelope, raw, requiresSmtpUtf8 = false }) => ({
  envelope,
  rawMessage: createRawMessagePlan({
    envelope: { from: envelope.from ?? null, to: envelope.to },
    content: new TextEncoder().encode(`${raw}\r\n`),
  }),
  requiresSmtpUtf8,
});

module.exports = { rawSmtpMessage };
