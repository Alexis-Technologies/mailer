// Ported from unemail v0.7.0 (src/drivers/_uuid.ts): an idempotency key as a
// UUID, for the providers that take no other (Brevo, Azure).
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: the hash is the synchronous SHA-256 of node:crypto.

const { createHash, createHmac } = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A key as a UUID: a UUID as it is, anything else hashed into a well-formed
 * version 4 UUID, the same for the same key and another for any other.
 *
 * @param key An idempotency key.
 * @returns The UUID.
 * @internal
 */
const uuidOf = (bytes) => {
  // The version and variant nibbles, as a provider that checks the shape wants.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex', 0, 16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const toUuid = (key) => {
  if (UUID.test(key)) return key.toLowerCase();
  return uuidOf(createHash('sha256').update(key, 'utf8').digest());
};

// Changed in the port: a key under a secret, an HMAC-SHA256 rather than a
// hash anyone can recompute, so that a key that names a person (an address)
// cannot be found again from its UUID by trying the addresses one knows.
/**
 * A key as a UUID under a secret.
 *
 * @param key The key.
 * @param secret The secret.
 * @returns The UUID, the same for the same key and secret.
 * @internal
 */
const toKeyedUuid = (key, secret) =>
  uuidOf(createHmac('sha256', secret).update(key, 'utf8').digest());

module.exports = { toKeyedUuid, toUuid };
