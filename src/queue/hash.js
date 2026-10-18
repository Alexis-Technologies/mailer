// Not ported: the SHA-256 of a value of JSON, its keys in order, so that the
// same job hashes the same whatever order its fields were written in.

const { createHash } = require('node:crypto');

const update = (hash, value) => {
  if (value === null || typeof value !== 'object') {
    hash.update(JSON.stringify(value));
    return;
  }
  if (Array.isArray(value)) {
    hash.update('[');
    for (let index = 0; index < value.length; index++) {
      if (index > 0) hash.update(',');
      update(hash, value[index]);
    }
    hash.update(']');
    return;
  }
  hash.update('{');
  let first = true;
  for (const key of Object.keys(value).toSorted()) {
    if (value[key] === undefined) continue;
    hash.update(`${first ? '' : ','}${JSON.stringify(key)}:`);
    first = false;
    update(hash, value[key]);
  }
  hash.update('}');
};

/**
 * The SHA-256 of a value of JSON in its canonical form, its keys sorted.
 *
 * @param value The value.
 * @param leaveOut Keys of the top object left out, such as the hash itself.
 * @returns The hash, in hexadecimal.
 * @internal
 */
const hashJson = (value, leaveOut) => {
  const hash = createHash('sha256');
  if (leaveOut === undefined) {
    update(hash, value);
  } else {
    const kept = {};
    for (const key of Object.keys(value)) {
      if (!leaveOut.has(key)) kept[key] = value[key];
    }
    update(hash, kept);
  }
  return hash.digest('hex');
};

module.exports = { hashJson };
