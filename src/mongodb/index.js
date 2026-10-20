// Not ported: the entry of ./mongodb, the stores of the reliability layer in
// collections of the MongoDB driver the application passes in: the outbox
// of the mail queue, its audit and its idempotency keys.

const { createMongoAuditSink } = require('./audit-sink.js');
const { createMongoIdempotencyStore } = require('./idempotency-store.js');
const { createMongoOutbox } = require('./outbox.js');

module.exports = { createMongoAuditSink, createMongoIdempotencyStore, createMongoOutbox };
