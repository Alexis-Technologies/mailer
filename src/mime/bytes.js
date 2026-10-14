// Ported from upyo v0.7.0 (packages/mime/src/bytes.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

/** @internal */
const utf8 = (value) => {
  return new TextEncoder().encode(value);
};
/** @internal */
const base64 = (bytes) => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
};

module.exports = { utf8, base64 };
