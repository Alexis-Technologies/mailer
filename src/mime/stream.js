// Ported from upyo v0.7.0 (packages/mime/src/stream.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createHash } = require('node:crypto');
const { RawMessageValidationError } = require('../core/raw-message.js');
const { base64, utf8 } = require('./bytes.js');
const { BodyHasher } = require('./dkim/body-hash.js');
const { signWithBodyHash } = require('./dkim/sign.js');

/**
 * A replayable attachment changed between DKIM body reads.
 */
class MimeAttachmentReplayError extends RawMessageValidationError {
  /** Creates a replay validation failure. */
  constructor() {
    super('Attachment content changed between DKIM body reads.', 'content');
    this.name = 'MimeAttachmentReplayError';
  }
}

/** Prepares signatures without speculative unsigned attachment reads. @internal */
const prepareMimeStream = async (plan, options = {}) => {
  const { knownSize, signal } = options;
  signal?.throwIfAborted();
  const progress = options.progress ?? (() => {});
  const checkSize = (size) => {
    if (!Number.isSafeInteger(size)) {
      throw new RangeError('Message size exceeds the safe integer range.');
    }
    options.checkSize?.(size);
  };
  if (knownSize != null) checkSize(knownSize);
  const signatures = plan.dkim?.signatures ?? [];
  if (signatures.length === 0) {
    return {
      size: knownSize,
      encoding: plan.encoding,
      // oxlint-disable-next-line no-shadow -- upstream
      async *read(signal, progress) {
        signal?.throwIfAborted();
        yield utf8(plan.headers);
        yield* plan.body(signal, progress);
      },
    };
  }
  const buffered = plan.dkim?.bodyMode !== 'streaming';
  const chunks = [];
  const hashes = new Map();
  for (const sig of signatures) {
    const mode = sig.canonicalization?.endsWith('/simple') ? 'simple' : 'relaxed';
    if (!hashes.has(mode)) hashes.set(mode, new BodyHasher(mode));
  }
  const rawHash = createHash('sha256');
  let length = 0;
  const headerLength = utf8(plan.headers).length;
  for await (const chunk of plan.body(signal, progress)) {
    length += chunk.length;
    checkSize(headerLength + length);
    if (chunk.length > 0) progress();
    if (buffered) chunks.push(chunk.slice());
    rawHash.update(chunk);
    for (const hash of hashes.values()) hash.update(chunk);
  }
  const expectedDigest = base64(rawHash.digest());
  const bodyHashes = new Map(Array.from(hashes, ([mode, hash]) => [mode, hash.digest()]));
  let headers = plan.headers;
  try {
    for (const sig of signatures) {
      const mode = sig.canonicalization?.endsWith('/simple') ? 'simple' : 'relaxed';
      const result = await signWithBodyHash(headers, sig, bodyHashes.get(mode), signal);
      headers = `${result.headerName}: ${result.signature}\r\n${headers}`;
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (plan.dkim?.onSigningFailure !== 'send-unsigned') throw error;
    // oxlint-disable-next-line no-console -- upstream
    console.warn('DKIM signing failed, sending unsigned:', error);
  }
  signal?.throwIfAborted();
  if (headers.split('\r\n').some((line) => utf8(line).length > 998)) {
    throw new RangeError('Signed MIME header exceeds the RFC 5322 line limit.');
  }
  const size = utf8(headers).length + length;
  checkSize(size);
  return {
    size,
    encoding: plan.encoding === 'utf8' || /[\u0080-\uffff]/.test(headers) ? 'utf8' : '7bit',
    // oxlint-disable-next-line no-shadow -- upstream
    async *read(signal, progress) {
      signal?.throwIfAborted();
      yield utf8(headers);
      if (buffered) {
        for (const chunk of chunks) {
          signal?.throwIfAborted();
          yield chunk.slice();
        }
        return;
      }
      const replayHash = createHash('sha256');
      let replayLength = 0;
      for await (const chunk of plan.body(signal, progress)) {
        replayLength += chunk.length;
        if (replayLength > length) throw new MimeAttachmentReplayError();
        replayHash.update(chunk);
        yield chunk;
      }
      if (replayLength !== length || base64(replayHash.digest()) !== expectedDigest) {
        throw new MimeAttachmentReplayError();
      }
    },
  };
};

module.exports = { MimeAttachmentReplayError, prepareMimeStream };
