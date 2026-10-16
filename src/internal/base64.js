// Not ported from upyo: the one base64 encoder of the HTTP providers, which
// carried seven, from String.fromCharCode with btoa to string concatenation
// byte by byte, all far slower than Buffer, which Node always has.

const { Buffer } = require('node:buffer');

/**
 * Encodes bytes as base64, over the same memory.
 *
 * @param bytes The bytes to encode.
 * @returns The base64 text.
 * @internal
 */
const toBase64 = (bytes) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');

module.exports = { toBase64 };
