// Ported from http_ece v1.2.1 (ece.js): the encryption of a push message,
// one record of aes128gcm (RFC 8188), its key and nonce derived as Web Push
// derives them (RFC 8291 §3.3–3.4): the secret of an ECDH of an ephemeral key
// with the key of the subscription, under its authentication secret.
// https://github.com/web-push-libs/encrypted-content-encoding — MIT, Copyright 2015 Martin Thomson
// Changed in the port: one record with no padding, which a push takes, on
// `hkdfSync` of node:crypto in place of an HMAC of its own; the key log of
// `ECE_KEYLOG`, which printed every key, is not ported (EC1).

const { Buffer } = require('node:buffer');
const { createCipheriv, createECDH, hkdfSync, randomBytes } = require('node:crypto');

const RECORD_SIZE = 4096;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_INFO = Buffer.from('Content-Encoding: aes128gcm\0');
const NONCE_INFO = Buffer.from('Content-Encoding: nonce\0');
const WEBPUSH_INFO = Buffer.from('WebPush: info\0');
// The header of the body: the salt, the record size, and the public key of
// the sender as the id of its key (65 bytes).
const HEADER_LENGTH = SALT_LENGTH + 4 + 1 + 65;
/**
 * The most bytes a push carries: what a body of 4096 bytes leaves of its
 * one record once the header, the delimiter and the tag are written.
 *
 * @internal
 */
const MAX_PLAINTEXT = RECORD_SIZE - HEADER_LENGTH - 1 - TAG_LENGTH;

const hkdf = (ikm, salt, info, length) => Buffer.from(hkdfSync('sha256', ikm, salt, info, length));

/**
 * Encrypts a push message for a subscription.
 *
 * @param plaintext The bytes of the message, `MAX_PLAINTEXT` at most.
 * @param subscription `{ p256dh, auth }`, the keys of the subscription as bytes.
 * @param options `ecdh`, an ephemeral key of `createECDH`, and `salt`, for
 * the vectors of the RFCs; new ones by default.
 * @returns The body of the request, its header and its one record.
 * @internal
 */
const encryptPush = (plaintext, subscription, options = {}) => {
  const ecdh = options.ecdh ?? createECDH('prime256v1');
  if (options.ecdh === undefined) ecdh.generateKeys();
  const salt = options.salt ?? randomBytes(SALT_LENGTH);
  const senderPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(subscription.p256dh);
  const keyInfo = Buffer.concat([WEBPUSH_INFO, subscription.p256dh, senderPublic]);
  const ikm = hkdf(secret, subscription.auth, keyInfo, 32);
  const key = hkdf(ikm, salt, KEY_INFO, 16);
  const nonce = hkdf(ikm, salt, NONCE_INFO, 12);
  const cipher = createCipheriv('aes-128-gcm', key, nonce);
  // The last record of a message ends with the delimiter 0x02.
  const record = Buffer.concat([
    cipher.update(plaintext),
    cipher.update(Buffer.of(2)),
    cipher.final(),
  ]);
  const header = Buffer.alloc(SALT_LENGTH + 5);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, SALT_LENGTH);
  header.writeUInt8(senderPublic.length, SALT_LENGTH + 4);
  return Buffer.concat([header, senderPublic, record, cipher.getAuthTag()]);
};

module.exports = { MAX_PLAINTEXT, encryptPush };
