// Not ported: the identifiers a job derives rather than draws: its id, from
// its namespace, tenant and key, and the Message-ID and Content-IDs of a job
// enqueued under a key, from its id. They are UUIDs of a hash by default, or
// what `deriveId(kind, seed)` of the application makes of that hash. Unlike
// `generateId`, which gives a new identifier at each call (a ULID, a cuid2),
// it must give the same for the same seed: the same message enqueued again is
// then the same job, with the same Message-ID, rather than another job (sent
// twice) or a message refused as another under its key.

const { Buffer } = require('node:buffer');
const { createHash, createHmac } = require('node:crypto');
const { isDotAtomText } = require('../core/text.js');
const { toKeyedUuid, toUuid } = require('../internal/uuid.js');

const MAX_JOB_ID_LENGTH = 128;
const MAX_ID_LENGTH = 256;
const ALL_DIGITS = /^\d+$/;

const isPrintableAscii = (value) => {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
};

// What every driver takes as the id of a job, and what a header field takes
// as the left half of a Message-ID or a Content-ID.
const isValid = (kind, value) => {
  if (typeof value !== 'string' || value.length === 0 || !isPrintableAscii(value)) return false;
  if (kind === 'job-id') {
    return value.length <= MAX_JOB_ID_LENGTH && !value.includes(':') && !ALL_DIGITS.test(value);
  }
  return value.length <= MAX_ID_LENGTH && isDotAtomText(value);
};

// The seed given to `deriveId`: a SHA-256 in hexadecimal of what the id
// derives from, or its HMAC under `idSecret`, so that it holds no key as given.
const seedOf = (text, secret) =>
  (secret === undefined ? createHash('sha256') : createHmac('sha256', secret))
    .update(Buffer.from(text, 'utf8'))
    .digest('hex');

/**
 * Derives an identifier of a job.
 *
 * @param kind `job-id`, `message-id` or `content-id`.
 * @param text What it derives from: the namespace, tenant and key of the job
 * for its id; its id and what is named for the others.
 * @param config `deriveId` and `idSecret`, both optional.
 * @returns The identifier: a UUID of the hash by default.
 * @throws {TypeError} If `deriveId` gives an identifier that is not one, or
 * another one for the same seed.
 * @internal
 */
const deriveJobId = (kind, text, config) => {
  const secret = kind === 'job-id' ? config.idSecret : undefined;
  if (config.deriveId === undefined) {
    return secret === undefined ? toUuid(text) : toKeyedUuid(text, secret);
  }
  const seed = seedOf(text, secret);
  const value = config.deriveId(kind, seed);
  if (!isValid(kind, value)) {
    throw new TypeError(
      `Invalid ${kind} from deriveId: ${JSON.stringify(String(value).slice(0, 100))}.`,
    );
  }
  // A generator of new identifiers given by mistake breaks every duplicate.
  if (config.deriveId(kind, seed) !== value) {
    throw new TypeError(
      `deriveId gave another ${kind} for the same seed: it must derive, not generate.`,
    );
  }
  return value;
};

module.exports = { deriveJobId };
