// Ported from upyo v0.7.0 (packages/mime/src/bytes.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { Buffer } = require('node:buffer');

const ENCODER = new TextEncoder();

/** @internal */
const utf8 = (value) => {
  return ENCODER.encode(value);
};
/**
 * Encodes bytes as base64 with `Buffer`, over the same memory: upstream built
 * a binary string with `String.fromCharCode` for `btoa`, about 180 times
 * slower on an attachment.
 * @internal
 */
const base64 = (bytes) => {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
};

/**
 * Tells whether a text of CRLF-separated lines has one longer than `limit`
 * bytes in UTF-8, without splitting it into an array of lines.
 * @internal
 */
const hasLineLongerThan = (text, limit) => {
  for (let start = 0; start <= text.length;) {
    let end = text.indexOf('\r\n', start);
    if (end === -1) end = text.length;
    // A UTF-16 code unit takes at most three bytes in UTF-8.
    if ((end - start) * 3 > limit && Buffer.byteLength(text.slice(start, end)) > limit) {
      return true;
    }
    start = end + 2;
  }
  return false;
};

module.exports = { utf8, base64, hasLineLongerThan };
