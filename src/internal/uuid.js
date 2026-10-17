// Ported from unemail v0.7.0 (src/drivers/_uuid.ts): an idempotency key as a
// UUID, for the providers that take no other (Brevo, Azure).
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: the hash is the synchronous SHA-256 of node:crypto.

const { createHash } = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A key as a UUID: a UUID as it is, anything else hashed into a well-formed
 * version 4 UUID, the same for the same key and another for any other.
 *
 * @param key An idempotency key.
 * @returns The UUID.
 * @internal
 */
const toUuid = (key) => {
  if (UUID.test(key)) return key.toLowerCase();
  const bytes = createHash('sha256').update(key, 'utf8').digest();
  // The version and variant nibbles, as a provider that checks the shape wants.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex', 0, 16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

module.exports = { toUuid };
