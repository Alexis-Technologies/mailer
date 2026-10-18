// Ported from unemail v0.7.0 (src/middleware/idempotency.ts): the in-process
// store of idempotency keys, `memoryIdempotencyStore`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: a key is reserved before the send, so a second send
// under it finds it taken, where unemail looked a key up and wrote it only
// after the send; a reservation lasts its lease and carries a token, so that
// only its owner completes or releases it; a record keeps the fingerprint of
// the message; the clock is injected; and a pending key is never dropped to
// make room, where unemail dropped the oldest keys whatever their state.

const { randomUUID } = require('node:crypto');
const { checkOptionalFunction, checkPositiveInteger } = require('../internal/options.js');

// The intervals are measured on a clock no change of the time of day moves.
const monotonic = () => performance.now();

/**
 * Makes a store of idempotency keys in this process: shared by the
 * transports given it, not by other processes, and lost on a restart.  A key
 * is `pending` for the lease `reserve` gives it, under a token of its own,
 * and `done` for the time `complete` gives it.
 *
 * It holds at most `maxEntries` keys.  To make room it drops the keys whose
 * time has passed, then the oldest `done` ones, while they are still within
 * their time: a message sent again under a key so dropped goes again.  A
 * `pending` key is never dropped before its lease ends, so while more sends
 * than `maxEntries` are in flight the store holds more keys.
 *
 * @param options `maxEntries` (100000) and `now`.
 * @returns The store.
 * @throws {TypeError} If an option is invalid.
 */
const createMemoryIdempotencyStore = (options = {}) => {
  const maxEntries = checkPositiveInteger(options.maxEntries ?? 100000, 'maxEntries');
  const now = checkOptionalFunction(options.now, 'now') ?? monotonic;
  // A key is in one of the two.  Each Map iterates in the order of insertion
  // and an entry is written anew when it changes; as the keys of one state
  // share a lease or a time, the first of each is also the first to expire.
  const pending = new Map();
  const done = new Map();

  const isFull = () => pending.size + done.size > maxEntries;

  const dropExpired = (entries, at) => {
    for (const [key, entry] of entries) {
      if (!isFull() || entry.expiresAt > at) return;
      entries.delete(key);
    }
  };

  const trim = (at) => {
    dropExpired(pending, at);
    dropExpired(done, at);
    for (const key of done.keys()) {
      if (!isFull()) return;
      done.delete(key);
    }
  };

  const write = (entries, key, entry, at) => {
    pending.delete(key);
    done.delete(key);
    entries.set(key, entry);
    if (isFull()) trim(at);
  };

  const entryOf = (key) => pending.get(key) ?? done.get(key);

  return {
    reserve(key, fingerprint, leaseMs) {
      const at = now();
      const entry = entryOf(key);
      if (entry !== undefined && entry.expiresAt > at) return { record: entry.record };
      const token = randomUUID();
      const record = { state: 'pending', fingerprint };
      write(pending, key, { record, token, expiresAt: at + leaseMs }, at);
      return { token };
    },
    complete(key, token, record, ttlMs) {
      const at = now();
      const entry = entryOf(key);
      // Taken by another reservation once this one's lease passed: it is theirs.
      if (entry !== undefined && entry.token !== token && entry.expiresAt > at) return;
      const kept = { state: 'done', fingerprint: record.fingerprint, receipt: record.receipt };
      write(done, key, { record: kept, token, expiresAt: at + ttlMs }, at);
    },
    release(key, token) {
      if (pending.get(key)?.token === token) pending.delete(key);
    },
  };
};

module.exports = { createMemoryIdempotencyStore };
