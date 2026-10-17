// Ported from unemail v0.7.0 (src/middleware/idempotency.ts): the in-process
// store of idempotency keys, `memoryIdempotencyStore`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: a key is reserved before the send, so a second send
// under it finds it taken, where unemail looked a key up and wrote it only
// after the send; a record keeps the fingerprint of the message; and the
// clock is injected.

const { checkOptionalFunction, checkPositiveInteger } = require('../internal/options.js');

/**
 * Makes a store of idempotency keys in this process: shared by the
 * transports given it, not by other processes, and lost on a restart.  It
 * holds at most `maxEntries` keys, dropping the oldest first.
 *
 * @param options `maxEntries` (100000) and `now`.
 * @returns The store.
 * @throws {TypeError} If an option is invalid.
 */
const createMemoryIdempotencyStore = (options = {}) => {
  const maxEntries = checkPositiveInteger(options.maxEntries ?? 100000, 'maxEntries');
  const now = checkOptionalFunction(options.now, 'now') ?? Date.now;
  const entries = new Map();

  // A Map iterates in the order of insertion, and a record is written anew
  // when it changes, so the first ones are the oldest.
  const trim = () => {
    const at = now();
    for (const [key, entry] of entries) {
      if (entries.size <= maxEntries && entry.expiresAt > at) break;
      entries.delete(key);
    }
  };

  const write = (key, entry) => {
    entries.delete(key);
    entries.set(key, entry);
    if (entries.size > maxEntries) trim();
  };

  return {
    reserve(key, fingerprint, ttlMs) {
      const entry = entries.get(key);
      if (entry !== undefined && entry.expiresAt > now()) {
        return { state: entry.state, fingerprint: entry.fingerprint, receipt: entry.receipt };
      }
      write(key, { state: 'pending', fingerprint, receipt: undefined, expiresAt: now() + ttlMs });
      return undefined;
    },
    complete(key, record, ttlMs) {
      write(key, {
        state: 'done',
        fingerprint: record.fingerprint,
        receipt: record.receipt,
        expiresAt: now() + ttlMs,
      });
    },
    release(key) {
      entries.delete(key);
    },
  };
};

module.exports = { createMemoryIdempotencyStore };
