// Ported from upyo v0.7.0 (packages/mime/src/index.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createRawMessagePlan } = require('../core/raw-message.js');
const { combineSignals } = require('../core/abort-signal.js');
const { prepareMimeMessage } = require('./message.js');
const { prepareMimeStream } = require('./stream.js');

const { MimeAttachmentReplayError } = require('./stream.js');

/**
 * Composes complete MIME bytes without SMTP framing or a Bcc header.
 * Unsigned messages read attachments lazily. DKIM reads the body during
 * preparation; streaming mode reads it again and verifies every replay.
 * Metadata is snapshotted before asynchronous work. Keep attachment bytes
 * immutable and provide independent, identical factory readers.
 * @param message The structured message to serialize.
 * @param options Signing and cancellation options.
 * @returns Replayable bytes accepted by raw-message transports.
 * @throws {RawMessageValidationError} If the derived envelope is invalid.
 * @throws {TypeError} If message metadata or signing configuration is invalid.
 * @throws {RangeError} If a MIME header exceeds the hard line-length limit.
 * @throws {Error} If signing, attachment reading, or cancellation fails.
 * Attachment errors can also occur during later content reads, after partial
 * output. Streaming DKIM changes throw {@link MimeAttachmentReplayError}.
 */
const envelopeRecipients = (message) => {
  const addresses = [];
  for (const list of [message.recipients, message.ccRecipients, message.bccRecipients]) {
    for (let i = 0; i < list.length; i++) addresses.push(list[i].address);
  }
  return addresses;
};

const composeMessage = async (message, options = {}) => {
  const { signal } = options;
  // The neutral plan observes promised sources even when envelope validation fails.
  const plan = prepareMimeMessage(message, options.dkim, options.generateId);
  const { envelope } = createRawMessagePlan({
    envelope: {
      from: message.sender.address,
      to: envelopeRecipients(message),
    },
    content: new Uint8Array(),
  });
  const stream = await prepareMimeStream(plan, { signal });
  signal?.throwIfAborted();
  return {
    envelope,
    encoding: stream.encoding,
    async *content(readerSignal) {
      const owned = new AbortController();
      const lifetime = combineSignals(owned.signal, signal);
      const reader = combineSignals(lifetime.signal, readerSignal);
      try {
        reader.signal.throwIfAborted();
        yield* stream.read(reader.signal);
      } finally {
        owned.abort();
        reader.cleanup();
        lifetime.cleanup();
      }
    },
  };
};

module.exports = { MimeAttachmentReplayError, composeMessage };
