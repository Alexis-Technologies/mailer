// Not ported: a store of idempotency keys in a collection of MongoDB, which
// the workers of several processes share: each method is one atomic step.
// A free key (absent, or whose time has passed) is taken by an upsert whose
// filter only a free key meets, so of two reserves one inserts and the other
// meets the duplicate key and reads the record.

const { randomUUID } = require('node:crypto');
const { checkOptionalFunction } = require('../internal/options.js');
const { checkCollection, isDuplicateKey } = require('./collection.js');

// Two reserves of a key that is dropped between them read it again.
const MAX_TRIES = 3;

const recordOf = (document) => {
  const record = { state: document.state, fingerprint: document.fingerprint };
  if (document.receipt !== undefined && document.receipt !== null) {
    record.receipt = document.receipt;
  }
  return record;
};

/**
 * Makes a store of idempotency keys in a collection, for `./idempotency`.
 *
 * @param options `collection`, `db.collection('mail_idempotency')`; `now`.
 * @returns The store: `reserve`, `complete` and `release`, and
 * `ensureIndexes()`, which makes the index that drops a key once its time
 * has passed.
 * @throws {TypeError} If an option is invalid.
 */
const createMongoIdempotencyStore = (options = {}) => {
  const collection = checkCollection(options.collection, 'createMongoIdempotencyStore', [
    'updateOne',
    'findOne',
    'deleteOne',
    'createIndex',
  ]);
  const now = checkOptionalFunction(options.now, 'now') ?? Date.now;
  return {
    async reserve(key, fingerprint, leaseMs) {
      for (let tries = 0; tries < MAX_TRIES; tries++) {
        const at = new Date(now());
        const token = randomUUID();
        try {
          await collection.updateOne(
            { _id: key, expiresAt: { $lte: at } },
            {
              $set: {
                state: 'pending',
                fingerprint,
                token,
                receipt: null,
                expiresAt: new Date(at.getTime() + leaseMs),
              },
            },
            { upsert: true },
          );
          return { token };
        } catch (error) {
          if (!isDuplicateKey(error)) throw error;
        }
        // Held within its time: what holds it.
        const held = await collection.findOne({ _id: key });
        if (held !== null && held !== undefined) return { record: recordOf(held) };
      }
      throw new Error(`The idempotency key could not be reserved in ${MAX_TRIES} tries.`);
    },
    async complete(key, token, record, ttlMs) {
      const at = new Date(now());
      try {
        await collection.updateOne(
          { _id: key, $or: [{ token }, { expiresAt: { $lte: at } }] },
          {
            $set: {
              state: 'done',
              fingerprint: record.fingerprint,
              receipt: record.receipt,
              token,
              expiresAt: new Date(at.getTime() + ttlMs),
            },
          },
          { upsert: true },
        );
      } catch (error) {
        // Another reservation holds it within its time: it is theirs.
        if (!isDuplicateKey(error)) throw error;
      }
    },
    async release(key, token) {
      await collection.deleteOne({ _id: key, token, state: 'pending' });
    },
    async ensureIndexes() {
      await collection.createIndex(
        { expiresAt: 1 },
        { name: 'mailer_expires', expireAfterSeconds: 0 },
      );
    },
  };
};

module.exports = { createMongoIdempotencyStore };
