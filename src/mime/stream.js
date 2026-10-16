// Ported from upyo v0.7.0 (packages/mime/src/stream.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createHash } = require('node:crypto');
const { RawMessageValidationError } = require('../core/raw-message.js');
const { Buffer } = require('node:buffer');
const { base64, hasLineLongerThan, utf8 } = require('./bytes.js');
const { BodyHasher } = require('./dkim/body-hash.js');
const { createLog, warnDegradation } = require('../internal/log.js');
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
  const body = await hashBody(plan, signatures, buffered, checkSize, signal, progress);
  const headers = await signHeaders(plan, signatures, body.hashes, signal);
  signal?.throwIfAborted();
  if (hasLineLongerThan(headers, 998)) {
    throw new RangeError('Signed MIME header exceeds the RFC 5322 line limit.');
  }
  const size = Buffer.byteLength(headers) + body.length;
  checkSize(size);
  return {
    size,
    encoding: plan.encoding === 'utf8' || /[\u0080-\uffff]/.test(headers) ? 'utf8' : '7bit',
    // oxlint-disable-next-line no-shadow -- upstream
    async *read(signal, progress) {
      signal?.throwIfAborted();
      yield utf8(headers);
      if (buffered) {
        for (const chunk of body.chunks) {
          signal?.throwIfAborted();
          yield chunk.slice();
        }
        return;
      }
      yield* replayBody(plan, body, signal, progress);
    },
  };
};

const canonicalizationOf = (signature) =>
  signature.canonicalization?.endsWith('/simple') ? 'simple' : 'relaxed';

/**
 * Reads the body once, hashing it for each body canonicalization the
 * signatures use, and keeping its chunks when it is buffered or the digest a
 * streamed replay is checked against.
 *
 * @returns The `hashes` by canonicalization, the `length`, and the `chunks`
 * or the `digest`.
 */
const hashBody = async (plan, signatures, buffered, checkSize, signal, progress) => {
  const hashers = new Map();
  for (const signature of signatures) {
    const mode = canonicalizationOf(signature);
    if (!hashers.has(mode)) hashers.set(mode, new BodyHasher(mode));
  }
  const chunks = [];
  // A buffered body is replayed from its own chunks and needs no digest.
  const rawHash = buffered ? undefined : createHash('sha256');
  let length = 0;
  const headerLength = Buffer.byteLength(plan.headers);
  for await (const chunk of plan.body(signal, progress)) {
    length += chunk.length;
    checkSize(headerLength + length);
    if (chunk.length > 0) progress();
    if (buffered) chunks.push(chunk.slice());
    rawHash?.update(chunk);
    for (const hasher of hashers.values()) hasher.update(chunk);
  }
  const hashes = new Map();
  for (const [mode, hasher] of hashers) hashes.set(mode, hasher.digest());
  const digest = rawHash == null ? undefined : base64(rawHash.digest());
  return { hashes, length, chunks, digest };
};

// The headers with a DKIM-Signature per signature on top, the last one first.
// When a signature fails and the configuration sends unsigned, the ones made
// before it stay.
const signHeaders = async (plan, signatures, hashes, signal) => {
  let headers = plan.headers;
  try {
    for (const signature of signatures) {
      const bodyHash = hashes.get(canonicalizationOf(signature));
      const result = await signWithBodyHash(headers, signature, bodyHash, signal);
      headers = `${result.headerName}: ${result.signature}\r\n${headers}`;
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (plan.dkim?.onSigningFailure !== 'send-unsigned') throw error;
    warnDegradation(
      plan.log ?? createLog(),
      'MAILER_DKIM_UNSIGNED',
      'DKIM signing failed; the message is sent unsigned, as onSigningFailure asks.',
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
  return headers;
};

// Reads a streamed body again and checks it is the one that was signed.
const replayBody = async function* (plan, body, signal, progress) {
  const replayHash = createHash('sha256');
  let replayLength = 0;
  for await (const chunk of plan.body(signal, progress)) {
    replayLength += chunk.length;
    if (replayLength > body.length) throw new MimeAttachmentReplayError();
    replayHash.update(chunk);
    yield chunk;
  }
  if (replayLength !== body.length || base64(replayHash.digest()) !== body.digest) {
    throw new MimeAttachmentReplayError();
  }
};

module.exports = { MimeAttachmentReplayError, prepareMimeStream };
