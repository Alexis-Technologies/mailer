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
  let size;
  if (content instanceof Uint8Array) size = content.byteLength;
  else if (content instanceof Blob) size = content.size;
  return {
    envelope: { from: envelope.from, to: [...envelope.to] },
    content,
    encoding: message.encoding,
    size,
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
  const encoding = options.encoding ?? plan.encoding;
  const scan = { offset: 0, line: 1, column: 0, pendingCr: false, headers: true, nonAscii: false };
  let sinceYield = 0;
  for await (const chunk of iterateAttachmentContent(plan.content, options.signal)) {
    for (let start = 0; start < chunk.length; start += RAW_WINDOW_BYTES) {
      options.signal?.throwIfAborted();
      const window = chunk.subarray(start, start + RAW_WINDOW_BYTES);
      scanRawWindow(scan, window, encoding);
      if (options.expectedSize !== undefined && scan.offset > options.expectedSize) {
        throw rawError('Raw message size changed between reads.', scan.offset, scan.line);
      }
      options.onProgress?.({
        size: scan.offset,
        encoding: encoding ?? (scan.nonAscii ? 'utf8' : '7bit'),
      });
      options.signal?.throwIfAborted();
      yield window;
      options.signal?.throwIfAborted();
      sinceYield += window.length;
      if (sinceYield >= RAW_YIELD_BYTES) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        options.signal?.throwIfAborted();
        sinceYield = 0;
      }
    }
  }
  options.signal?.throwIfAborted();
  if (scan.offset === 0) {
    throw rawError('Raw message headers must not be empty.', scan.offset, scan.line);
  }
  if (scan.pendingCr || scan.column !== 0) {
    throw rawError('Raw messages must end with CRLF.', scan.offset, scan.line);
  }
  if (options.expectedSize !== undefined && scan.offset !== options.expectedSize) {
    throw rawError('Raw message size changed between reads.', scan.offset, scan.line);
  }
};

const RAW_WINDOW_BYTES = 32768;
// Bytes after which the traversal lets the event loop run.
const RAW_YIELD_BYTES = 1024 * 1024;

const rawError = (message, offset, line, field = 'content') =>
  new RawMessageValidationError(message, field, offset, line);

/**
 * Checks the bytes of one window against the wire rules and the declared
 * encoding, carrying the position over from the window before.  The state is
 * read into locals and written back once, so that the loop over each byte
 * touches no object.
 *
 * @param scan The position and what has been seen so far, updated in place.
 * @param window The bytes to check.
 * @param encoding The declared encoding, if any.
 * @throws {RawMessageValidationError} If a byte breaks a rule.
 */
const scanRawWindow = (scan, window, encoding) => {
  let { offset, line, column, pendingCr, headers, nonAscii } = scan;
  // An index loop: the iterator protocol of for...of costs more than the
  // checks on each byte.
  for (let index = 0; index < window.length; index++) {
    const byte = window[index];
    if (pendingCr) {
      if (byte !== 10) throw rawError('Expected LF after CR.', offset, line);
      if (line === 1 && column === 0) {
        throw rawError('Raw message headers must not be empty.', offset, line);
      }
      if (column === 0) headers = false;
      pendingCr = false;
      column = 0;
      line++;
    } else if (byte === 13) {
      pendingCr = true;
    } else if (byte === 10) {
      throw rawError('Raw messages must use CRLF line endings.', offset, line);
    } else {
      if (byte === 0) throw rawError('Raw messages must not contain NUL.', offset, line);
      if (++column > 998) {
        throw rawError('Raw message lines must not exceed 998 octets.', offset, line);
      }
      if (byte > 127) {
        nonAscii = true;
        if (encoding === '7bit' || (encoding === '8bit' && headers)) {
          throw rawError(
            'Raw message bytes exceed the declared encoding.',
            offset,
            line,
            'encoding',
          );
        }
      }
    }
    offset++;
  }
  scan.offset = offset;
  scan.line = line;
  scan.column = column;
  scan.pendingCr = pendingCr;
  scan.headers = headers;
  scan.nonAscii = nonAscii;
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
