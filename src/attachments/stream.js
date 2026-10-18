// Not ported: an attachment of a stream, read once and held, since a message
// may be read more than once (a DKIM signature, a retry, another transport of a
// pool) and a stream cannot be.

const { joinChunks } = require('../internal/body.js');
const { checkMaxBytes, createAttachment } = require('./attachment.js');
const { DEFAULT_TYPE, extensionOfType, typeOfFilename } = require('./mime-types.js');

/**
 * Makes an attachment of what a stream gives, read now.
 *
 * @param source A Node.js `Readable`, a web `ReadableStream` or another async
 * iterable of bytes.
 * @param options `maxBytes` (25 MiB) and `signal`, and the fields of the
 * attachment: by default `attachment.bin` and the type of its extension.
 * @returns The attachment, its content in memory.
 * @throws {TypeError} If the source is not an async iterable of bytes, or a
 * field is invalid.
 * @throws {RangeError} If it gives more than `maxBytes`.
 */
const fromStream = async (source, options = {}) => {
  const maxBytes = checkMaxBytes(options.maxBytes);
  if (source == null || typeof source[Symbol.asyncIterator] !== 'function') {
    throw new TypeError('fromStream() needs an async iterable of bytes.');
  }
  options.signal?.throwIfAborted();
  const chunks = [];
  let sizeBytes = 0;
  for await (const chunk of source) {
    options.signal?.throwIfAborted();
    if (!(chunk instanceof Uint8Array)) {
      throw new TypeError('fromStream() reads bytes; a stream of text needs no encoding set.');
    }
    sizeBytes += chunk.byteLength;
    if (sizeBytes > maxBytes) throw new RangeError(`The stream gives more than ${maxBytes} bytes.`);
    chunks.push(chunk);
  }
  const filename = `attachment.${extensionOfType(DEFAULT_TYPE)}`;
  return createAttachment(options, joinChunks(chunks, sizeBytes), {
    filename,
    contentType: typeOfFilename(options.filename ?? filename),
  });
};

module.exports = { fromStream };
