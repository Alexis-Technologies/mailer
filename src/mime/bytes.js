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

module.exports = { utf8, base64 };
