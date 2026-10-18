// Ported from unemail v0.7.0 (src/middleware/idempotency.ts): the entry of the
// idempotency decorator and its in-process store.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const { IdempotencyTransport } = require('./idempotency-transport.js');
const { createMemoryIdempotencyStore } = require('./memory-store.js');

module.exports = { IdempotencyTransport, createMemoryIdempotencyStore };
