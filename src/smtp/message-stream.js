// Ported from upyo v0.7.0 (packages/smtp/src/message-stream.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { MimeAttachmentReplayError, prepareMimeStream } = require('../mime/stream.js');

/** A replayable attachment changed between DKIM body reads. @since 0.6.0 */
class SmtpAttachmentReplayError extends TypeError {
  /** Creates a replay validation failure. */
  constructor() {
    super('Attachment content changed between DKIM body reads.');
    this.name = 'SmtpAttachmentReplayError';
  }
}

/** Prepares signatures and sizes under the SMTP preparation timeout. */
const prepareMessageStream = async (plan, checkSize, progress, signal) => {
  try {
    const knownSize = await plan.size(signal, checkSize);
    const stream = await prepareMimeStream(plan, {
      knownSize,
      checkSize,
      progress,
      signal,
    });
    return {
      size: stream.size,
      encoding: stream.encoding,
      // oxlint-disable-next-line no-shadow -- upstream
      async *read(signal, progress) {
        try {
          yield* stream.read(signal, progress);
        } catch (error) {
          signal?.throwIfAborted();
          if (error instanceof MimeAttachmentReplayError) {
            throw new SmtpAttachmentReplayError();
          }
          throw error;
        }
      },
    };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof MimeAttachmentReplayError) {
      throw new SmtpAttachmentReplayError();
    }
    throw error;
  }
};

module.exports = { SmtpAttachmentReplayError, prepareMessageStream };
