// Not ported: the SHA-256 of a value of JSON, its keys in order, so that the
// same job hashes the same whatever order its fields were written in; and the
// HMAC of the same form, which only a holder of the key can make.

const { createHash, createHmac } = require('node:crypto');

const update = (digest, value) => {
  if (value === null || typeof value !== 'object') {
    digest.update(JSON.stringify(value));
    return;
  }
  if (Array.isArray(value)) {
    digest.update('[');
    for (let index = 0; index < value.length; index++) {
      if (index > 0) digest.update(',');
      update(digest, value[index]);
    }
    digest.update(']');
    return;
  }
  digest.update('{');
  let first = true;
  for (const key of Object.keys(value).toSorted()) {
    if (value[key] === undefined) continue;
    digest.update(`${first ? '' : ','}${JSON.stringify(key)}:`);
    first = false;
    update(digest, value[key]);
  }
  digest.update('}');
};

const digestJson = (digest, value, leaveOut) => {
  if (leaveOut === undefined) {
    update(digest, value);
  } else {
    const kept = {};
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

module.exports = { hashJson, macJson };
