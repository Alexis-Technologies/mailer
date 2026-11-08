// Not ported: what the jobs of email and of the channels share of their
// fields: a text of a bounded length, and bytes kept in a job in base64
// under the bound of a queue, which the worker turns back into bytes.

const { Buffer } = require('node:buffer');
const { toBase64 } = require('../internal/base64.js');

/**
 * Whether a value is a string of 1 to `max` characters.
 *
 * @internal
 */
const isText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;

/**
 * Whether a value is an object of JSON, no array.
 *
 * @internal
 */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether a value is the content of an attachment or a medium: bytes, a
 * Blob, a promise of them, or a factory of chunks.
 *
 * @internal
 */
const isContent = (value) =>
  value instanceof Uint8Array ||
  value instanceof Blob ||
  value instanceof Promise ||
  typeof value === 'function';

/**
 * Keeps bytes in a job, in base64, the bytes of the job so far counted
 * against `maxInlineAttachmentBytes`.
 *
 * @param content The bytes.
 * @param counter `{ bytes }`, the bytes kept so far, counted up.
 * @param config `maxInlineAttachmentBytes`.
 * @param what What holds them, `attachments` or `media`, for the error.
 * @returns The bytes in base64.
 * @throws {RangeError} If the job holds more than the bound.
 * @internal
 */
const storeBytes = (content, counter, config, what) => {
  counter.bytes += content.byteLength;
  if (counter.bytes > config.maxInlineAttachmentBytes) {
    throw new RangeError(
      `The ${what} of a job hold more than ${config.maxInlineAttachmentBytes} bytes; ` +
        'give larger ones as { ref }, resolved by the worker.',
    );
  }
  return toBase64(content);
};

/**
 * The bytes a job keeps in base64.
 *
 * @internal
 */
const bytesOf = (data) => new Uint8Array(Buffer.from(data, 'base64'));

module.exports = { bytesOf, isContent, isObject, isText, storeBytes };
