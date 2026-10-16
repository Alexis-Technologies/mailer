// Ported from upyo v0.7.0 (packages/mime/src/mime-stream.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { iterateAttachmentContent } = require('../core/attachment.js');
const { Buffer } = require('node:buffer');
const { base64 } = require('./bytes.js');

/** Encodes base64 without retaining producer-owned carry bytes. */
const encodeAttachment = async function* (content, signal, progress) {
  const carry = new Uint8Array(3);
  let carried = 0;
  let column = 0;
  // The base64 text is ASCII, so it is written straight into one buffer with
  // a CRLF after every 76 characters of the attachment, without joining
  // strings and encoding them again.
  const wrap = (encoded) => {
    const firstBreak = column === 76 ? 0 : 76 - column;
    const lineBreaks =
      encoded.length > firstBreak ? Math.ceil((encoded.length - firstBreak) / 76) : 0;
    const output = Buffer.allocUnsafe(encoded.length + 2 * lineBreaks);
    let written = 0;
    let offset = 0;
    while (offset < encoded.length) {
      if (column === 76) {
        output[written++] = 0x0d;
        output[written++] = 0x0a;
        column = 0;
      }
      const take = Math.min(76 - column, encoded.length - offset);
      written += output.latin1Write(encoded.slice(offset, offset + take), written);
      offset += take;
      column += take;
    }
    return output;
  };
  let processed = 0;
  for await (const chunk of iterateAttachmentContent(content, signal)) {
    if (chunk.length > 0) progress?.();
    let offset = 0;
    if (carried > 0) {
      while (carried < 3 && offset < chunk.length) {
        carry[carried++] = chunk[offset++];
      }
      if (carried === 3) {
        yield wrap(base64(carry));
        carried = 0;
      }
    }
    while (offset + 3 <= chunk.length) {
      signal?.throwIfAborted();
      const length = Math.min(45 * 1024, Math.floor((chunk.length - offset) / 3) * 3);
      yield wrap(base64(chunk.subarray(offset, offset + length)));
      offset += length;
      processed += length;
      if (processed >= 1024 * 1024) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        processed = 0;
      }
    }
    while (offset < chunk.length) carry[carried++] = chunk[offset++];
  }
  if (carried > 0) {
    yield wrap(base64(carry.subarray(0, carried)));
  }
};

/** Encoded payload length, excluding MIME framing and a trailing CRLF. */
const attachmentEncodedSize = (length) => {
  const encoded = 4 * Math.ceil(length / 3);
  return encoded + (encoded === 0 ? 0 : 2 * Math.floor((encoded - 1) / 76));
};

module.exports = { encodeAttachment, attachmentEncodedSize };
