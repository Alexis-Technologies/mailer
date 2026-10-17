// Ported from upyo v0.7.0 (packages/smtp/src/raw-message.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { analyzeRawMessage, iterateRawMessage } = require('../core/raw-message.js');
const { readAttachmentContent } = require('../core/attachment.js');
const { hasNonAsciiAddress } = require('./envelope.js');

/** Missing support for explicitly declared 8-bit MIME bodies. @since 0.6.0 */
class Smtp8BitMimeUnsupportedError extends TypeError {
  /** Creates an error for a server without 8BITMIME. */
  constructor() {
    super('SMTP server does not support 8BITMIME.');
    this.name = 'Smtp8BitMimeUnsupportedError';
  }
}

/** @internal */
const prepareRawSmtpMessage = (plan, dsn) => {
  return {
    rawMessage: plan,
    envelope: { ...plan.envelope, dsn },
    requiresSmtpUtf8: plan.encoding === 'utf8' || hasNonAsciiAddress(plan.envelope),
  };
};

/** @internal */
const prepareRawSmtpStream = async (source, negotiate, checkSize, progress, signal) => {
  let plan = source;
  // Resolve promised bytes within the socket preparation timeout and reuse
  // their identity for the transmission pass, without copying or composing.
  if (plan.content instanceof Promise) {
    const content = await readAttachmentContent(plan.content, signal);
    plan = { ...plan, content, size: content.byteLength };
    progress();
  }
  if (plan.size !== undefined) checkSize(plan.size);
  const analysis =
    plan.encoding === undefined
      ? await analyzeRawMessage(plan, signal, (info) => {
          progress();
          negotiate(info.encoding);
          checkSize(info.size);
        })
      : { size: plan.size, encoding: plan.encoding };
  signal?.throwIfAborted();
  negotiate(analysis.encoding);
  return {
    size: analysis.size,
    // oxlint-disable-next-line no-shadow -- upstream
    read(signal, progress) {
      return iterateRawMessage(plan, {
        signal,
        encoding: analysis.encoding,
        expectedSize: analysis.size,
        onProgress: () => progress?.(),
      });
    },
  };
};

module.exports = { Smtp8BitMimeUnsupportedError, prepareRawSmtpMessage, prepareRawSmtpStream };
