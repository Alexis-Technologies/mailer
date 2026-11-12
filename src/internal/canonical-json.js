// Not ported: the SHA-256 of a value of JSON in its canonical form, its keys
// in order, so that the same job hashes the same whatever order its fields
// were written in; and the HMAC of the same form, which only a holder of the
// key can make. The jobs of ./queue are hashed and signed with it, and a
// payload of a channel (a Block Kit, an Adaptive Card) is fingerprinted with
// it, so it is shared rather than kept by the queue.

const { createHash, createHmac } = require('node:crypto');

// The text of a value in its canonical form, written in pieces into a buffer
// that goes to the digest by the 64 KiB: a call of the digest per token, of
// which a payload of blocks holds thousands, cost tenfold the hash itself.
const CHUNK_LENGTH = 64 * 1024;

const createWriter = (digest) => {
  let buffered = '';
  return {
    write(text) {
      // A long string, the base64 of a file, goes as it is, not copied.
      if (text.length >= CHUNK_LENGTH) {
        if (buffered !== '') digest.update(buffered);
        buffered = '';
        digest.update(text);
        return;
      }
      buffered += text;
      if (buffered.length >= CHUNK_LENGTH) {
        digest.update(buffered);
        buffered = '';
      }
    },
    end() {
      if (buffered !== '') digest.update(buffered);
      buffered = '';
    },
  };
};

const write = (writer, value) => {
  if (value === null || typeof value !== 'object') {
    writer.write(JSON.stringify(value));
    return;
  }
  if (Array.isArray(value)) {
    writer.write('[');
    for (let index = 0; index < value.length; index++) {
      if (index > 0) writer.write(',');
      write(writer, value[index]);
    }
    writer.write(']');
    return;
  }
  writer.write('{');
  let first = true;
  for (const key of Object.keys(value).toSorted()) {
    if (value[key] === undefined) continue;
    writer.write(`${first ? '' : ','}${JSON.stringify(key)}:`);
    first = false;
    write(writer, value[key]);
  }
  writer.write('}');
};

const update = (digest, value) => {
  const writer = createWriter(digest);
  write(writer, value);
  writer.end();
};

const digestJson = (digest, value, leaveOut) => {
  if (leaveOut === undefined) {
    update(digest, value);
  } else {
    // No prototype, so that an own key `__proto__` is kept, and hashed, as a
    // key rather than set as the prototype of the copy and left out.
    const kept = Object.create(null);
    for (const key of Object.keys(value)) {
      if (!leaveOut.has(key)) kept[key] = value[key];
    }
    update(digest, kept);
  }
  return digest.digest('hex');
};

/**
 * The SHA-256 of a value of JSON in its canonical form, its keys sorted.
 *
 * @param value The value.
 * @param leaveOut Keys of the top object left out, such as the hash itself.
 * @returns The hash, in hexadecimal.
 * @internal
 */
const hashJson = (value, leaveOut) => digestJson(createHash('sha256'), value, leaveOut);

/**
 * The HMAC-SHA256 of a value of JSON in the canonical form of `hashJson`.
 *
 * @param secret The key.
 * @param value The value.
 * @param leaveOut Keys of the top object left out.
 * @returns The HMAC, in hexadecimal.
 * @internal
 */
const macJson = (secret, value, leaveOut) =>
  digestJson(createHmac('sha256', secret), value, leaveOut);

/**
 * Writes a value of JSON in its canonical form into a digest, as a part of
 * what the digest takes: the payload of a message of a channel in its
 * fingerprint.
 *
 * @param digest A hash or an HMAC of node:crypto.
 * @param value The value.
 * @internal
 */
const updateCanonical = (digest, value) => update(digest, value);

module.exports = { hashJson, macJson, updateCanonical };
