// Ported from upyo v0.7.0 (packages/core/src/raw-message.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { isEmailAddress } = require('./address.js');
const { iterateAttachmentContent } = require('./attachment.js');

/** Invalid raw-message metadata or wire structure. @since 0.6.0 */
class RawMessageValidationError extends TypeError {
  /** The invalid message field. */
  field;
  /** Zero-based byte offset, when the error refers to content. */
  byteOffset;
  /** One-based line number, when the error refers to content. */
  lineNumber;

  /**
   * Creates a raw-message validation error.
   * @param message Description of the failure.
   * @param field The invalid field.
   * @param byteOffset Optional zero-based content offset.
   * @param lineNumber Optional one-based line number.
   */
  constructor(message, field, byteOffset, lineNumber) {
    super(message);
    this.name = 'RawMessageValidationError';
    this.field = field;
    this.byteOffset = byteOffset;
    this.lineNumber = lineNumber;
  }
}

/**
 * Snapshots metadata and observes promised bytes before any asynchronous work.
 * @param message The raw message to validate.
 * @returns A replayable plan with a copied envelope.
 * @throws {RawMessageValidationError} If metadata or the source kind is invalid.
 * @internal
 */
const areEmailAddresses = (addresses) => {
  for (let i = 0; i < addresses.length; i++) {
    if (!isEmailAddress(addresses[i])) return false;
  }
  return true;
};

const createRawMessagePlan = (message) => {
  const content = message?.content;
  if (content instanceof Promise) content.catch(() => {});
  const envelope = message?.envelope;
  if (
    envelope == null ||
    (envelope.from !== null && !isEmailAddress(envelope.from)) ||
    !Array.isArray(envelope.to) ||
    envelope.to.length === 0 ||
    !areEmailAddresses(envelope.to)
  ) {
    throw new RawMessageValidationError('Invalid raw message envelope.', 'envelope');
  }
  if (
    message.encoding !== undefined &&
    message.encoding !== '7bit' &&
    message.encoding !== '8bit' &&
    message.encoding !== 'utf8'
  ) {
    throw new RawMessageValidationError('Invalid raw message encoding.', 'encoding');
  }
  if (
    !(content instanceof Uint8Array) &&
    !(content instanceof Promise) &&
    !(content instanceof Blob) &&
    typeof content !== 'function'
  ) {
    throw new RawMessageValidationError('Expected replayable raw message bytes.', 'content');
  }
  return {
    envelope: { from: envelope.from, to: [...envelope.to] },
    content,
    encoding: message.encoding,
    size:
      content instanceof Uint8Array
        ? content.byteLength
        : content instanceof Blob
          ? content.size
          : undefined,
  };
};

/**
 * Validates and yields at most 32 KiB per chunk, without prefetching. Chunks
 * remain valid until the next read; HTTP consumers must copy before enqueueing.
 * The source's own errors and cancellation reasons are preserved.
 * @param plan Validated metadata and replayable source.
 * @param options Cancellation, analysis observations, and transmission checks.
 * @returns Original bytes in bounded windows.
 * @throws {RawMessageValidationError} If wire structure or encoding is invalid.
 * @throws {Error} If the source fails or reading is cancelled.
 * @internal
 */
const iterateRawMessage = async function* (plan, options = {}) {
  let offset = 0;
  let line = 1;
  let column = 0;
  let pendingCr = false;
  let headers = true;
  let nonAscii = false;
  let sinceYield = 0;
  const encoding = options.encoding ?? plan.encoding;
  const fail = (message, field = 'content') => {
    throw new RawMessageValidationError(message, field, offset, line);
  };
  for await (const chunk of iterateAttachmentContent(plan.content, options.signal)) {
    for (let start = 0; start < chunk.length; start += 32768) {
      options.signal?.throwIfAborted();
      const window = chunk.subarray(start, start + 32768);
      // An index loop: the iterator protocol of for...of costs more than the
      // checks on each byte.
      for (let index = 0; index < window.length; index++) {
        const byte = window[index];
        if (pendingCr) {
          if (byte !== 10) fail('Expected LF after CR.');
          if (line === 1 && column === 0) {
            fail('Raw message headers must not be empty.');
          }
          if (column === 0) headers = false;
          pendingCr = false;
          column = 0;
          line++;
        } else if (byte === 13) {
          pendingCr = true;
        } else if (byte === 10) {
          fail('Raw messages must use CRLF line endings.');
        } else {
          if (byte === 0) fail('Raw messages must not contain NUL.');
          if (++column > 998) {
            fail('Raw message lines must not exceed 998 octets.');
          }
          if (byte > 127) {
            nonAscii = true;
            if (encoding === '7bit' || (encoding === '8bit' && headers)) {
              fail('Raw message bytes exceed the declared encoding.', 'encoding');
            }
          }
        }
        offset++;
      }
      if (options.expectedSize !== undefined && offset > options.expectedSize) {
        fail('Raw message size changed between reads.');
      }
      options.onProgress?.({
        size: offset,
        encoding: encoding ?? (nonAscii ? 'utf8' : '7bit'),
      });
      options.signal?.throwIfAborted();
      yield window;
      options.signal?.throwIfAborted();
      sinceYield += window.length;
      if (sinceYield >= 1024 * 1024) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        options.signal?.throwIfAborted();
        sinceYield = 0;
      }
    }
  }
  options.signal?.throwIfAborted();
  if (offset === 0) fail('Raw message headers must not be empty.');
  if (pendingCr || column !== 0) fail('Raw messages must end with CRLF.');
  if (options.expectedSize !== undefined && offset !== options.expectedSize) {
    fail('Raw message size changed between reads.');
  }
};

/**
 * Analyzes one complete traversal without retaining the message in memory.
 * @param plan Validated metadata and replayable source.
 * @param signal Cancellation signal.
 * @param onProgress Optional incremental observations, also allowed to reject.
 * @returns The byte length and conservative transport encoding.
 * @throws {RawMessageValidationError} If the raw content is invalid.
 * @throws {Error} If the source or progress callback fails, or reading is cancelled.
 * @internal
 */
const analyzeRawMessage = async (plan, signal, onProgress) => {
  let result = { size: 0, encoding: '7bit' };
  // oxlint-disable-next-line no-unused-vars -- upstream: only the progress callback is read
  for await (const _ of iterateRawMessage(plan, {
    signal,
    onProgress(info) {
      result = info;
      onProgress?.(info);
    },
  })) {
    /* Validation happens during iteration. */
  }
  return result;
};

module.exports = {
  RawMessageValidationError,
  createRawMessagePlan,
  iterateRawMessage,
  analyzeRawMessage,
};
