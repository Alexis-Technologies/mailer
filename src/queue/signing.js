// Not ported: the signature of a job, an HMAC-SHA256 of its canonical form
// under a key of the application's. Its SHA-256 tells a job that changed, but
// whoever can write to the store of the queue can recompute it, and so make
// the worker send a message of their own from the application's domain; the
// HMAC only a holder of a key can make.

const { Buffer } = require('node:buffer');
const { timingSafeEqual } = require('node:crypto');
const { MailQueueError } = require('./errors.js');
const { macJson } = require('./hash.js');

const MIN_SECRET_BYTES = 32;
const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
const MAC = /^[0-9a-f]{64}$/;

// The keyring of each array of keys given, checked once.
const keyrings = new WeakMap();

const secretBytes = (secret) =>
  typeof secret === 'string' ? Buffer.byteLength(secret) : secret.byteLength;

const checkKey = (key, keys) => {
  const id = key?.id;
  const secret = key?.secret;
  if (typeof id !== 'string' || !KEY_ID.test(id)) {
    throw new TypeError('The id of a signing key is 1 to 64 of A-Z, a-z, 0-9, ".", "_" and "-".');
  }
  if (
    (typeof secret !== 'string' && !(secret instanceof Uint8Array)) ||
    secretBytes(secret) < MIN_SECRET_BYTES
  ) {
    throw new TypeError(
      `The secret of the signing key ${id} must hold ${MIN_SECRET_BYTES} bytes at least.`,
    );
  }
  if (keys.has(id)) throw new TypeError(`The signing key ${id} is given twice.`);
  keys.set(id, secret);
};

/**
 * Checks the signing keys of a queue or a worker: the first signs, and each
 * verifies, so that a key is rotated by putting the new one first and
 * dropping the old one once no job it signed is left.
 *
 * @param signingKeys `[{ id, secret }]`, a secret of 32 bytes at least, or
 * nothing.
 * @returns The keyring, `{ signer, keys }`, or `undefined` for none.
 * @throws {TypeError} If a key is invalid.
 * @internal
 */
const keyringOf = (signingKeys) => {
  if (signingKeys === undefined) return undefined;
  if (!Array.isArray(signingKeys) || signingKeys.length === 0) {
    throw new TypeError('signingKeys must be a non-empty array of { id, secret }.');
  }
  const known = keyrings.get(signingKeys);
  if (known !== undefined) return known;
  const keys = new Map();
  for (const key of signingKeys) checkKey(key, keys);
  const keyring = { signer: signingKeys[0].id, keys };
  keyrings.set(signingKeys, keyring);
  return keyring;
};

/**
 * Signs the data of a job with the first key: `kid` and `mac`.
 *
 * @param data The data, its hash made.
 * @param keyring The keyring.
 * @param leaveOut The fields the hash leaves out, `mac` and `kid` among them.
 * @internal
 */
const signJob = (data, keyring, leaveOut) => {
  data.kid = keyring.signer;
  data.mac = macJson(keyring.keys.get(keyring.signer), data, leaveOut);
};

const invalid = (message) => new MailQueueError('queue.signature_invalid', message);

/**
 * Verifies the signature of the data of a job read from its store.
 *
 * @param data The data.
 * @param keyring The keyring.
 * @param leaveOut The fields the hash leaves out.
 * @throws {MailQueueError} `queue.signature_invalid` if the job is not
 * signed, by a key the keyring holds, or its signature does not verify.
 * @internal
 */
const verifyJob = (data, keyring, leaveOut) => {
  if (typeof data.mac !== 'string' || typeof data.kid !== 'string') {
    throw invalid('The job is not signed, and this worker reads only signed jobs.');
  }
  const secret = keyring.keys.get(data.kid);
  if (secret === undefined) {
    throw invalid(
      `The job is signed with the key ${JSON.stringify(data.kid.slice(0, 64))}, ` +
        'which this worker does not hold.',
    );
  }
  if (!MAC.test(data.mac)) throw invalid('The signature of the job is not an HMAC-SHA256.');
  const expected = Buffer.from(macJson(secret, data, leaveOut), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(data.mac, 'hex'))) {
    throw invalid('The signature of the job does not verify: it is not what was enqueued.');
  }
};

module.exports = { keyringOf, signJob, verifyJob };
