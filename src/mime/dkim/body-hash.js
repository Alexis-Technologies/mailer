// Ported from upyo v0.7.0 (packages/mime/src/dkim/body-hash.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createHash } = require('node:crypto');
const { base64 } = require('../bytes.js');

/** Incremental RFC 6376 body hash with bounded whitespace and line state. */
class BodyHasher {
  hash = createHash('sha256');
  buffer = new Uint8Array(65536);
  used = 0;
  cr = false;
  whitespace = false;
  newlines = 0;
  nonempty = false;

  mode;

  constructor(mode) {
    this.mode = mode;
  }

  update(bytes) {
    const relaxed = this.mode === 'relaxed';
    for (let offset = 0; offset < bytes.length;) {
      const byte = bytes[offset++];
      if (this.cr) {
        this.cr = false;
        if (byte === 10) {
          this.whitespace = false;
          this.newlines++;
          continue;
        }
        this.content(13);
      }
      if (byte === 13) {
        this.cr = true;
      } else if (relaxed && (byte === 32 || byte === 9)) {
        this.whitespace = true;
      } else {
        this.content(byte);
        // Only CR and relaxed-mode whitespace need per-byte state changes.
        const start = offset;
        while (
          offset < bytes.length &&
          bytes[offset] !== 13 &&
          // oxlint-disable-next-line no-unmodified-loop-condition -- upstream
          (!relaxed || (bytes[offset] !== 32 && bytes[offset] !== 9))
        ) {
          offset++;
        }
        this.emitSpan(bytes, start, offset);
      }
    }
  }

  emitSpan(bytes, start, end) {
    while (start < end) {
      const length = Math.min(end - start, this.buffer.length - this.used);
      this.buffer.set(bytes.subarray(start, start + length), this.used);
      this.used += length;
      start += length;
      if (this.used === this.buffer.length) {
        this.hash.update(this.buffer);
        this.used = 0;
      }
    }
  }

  content(byte) {
    if (this.mode === 'relaxed' && (byte === 32 || byte === 9)) {
      this.whitespace = true;
      return;
    }
    while (this.newlines > 0) {
      this.emit(13);
      this.emit(10);
      this.newlines--;
    }
    if (this.whitespace) {
      this.emit(32);
      this.whitespace = false;
    }
    this.emit(byte);
    this.nonempty = true;
  }

  emit(byte) {
    this.buffer[this.used++] = byte;
    if (this.used === this.buffer.length) {
      this.hash.update(this.buffer);
      this.used = 0;
    }
  }

  digest() {
    if (this.cr) this.content(13);
    if (this.nonempty || this.mode === 'simple') {
      this.emit(13);
      this.emit(10);
    }
    this.hash.update(this.buffer.subarray(0, this.used));
    return base64(this.hash.digest());
  }
}

module.exports = { BodyHasher };
