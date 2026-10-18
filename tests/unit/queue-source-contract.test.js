// Not ported: the contract of a QueueSource held by the memory queue and by
// the MongoDB outbox on a collection in memory (tests/mongodb holds it on
// MongoDB itself).
const { createMongoOutbox } = require('../../src/mongodb/index.js');
const { createMemoryQueue } = require('../../src/queue/index.js');
const { fakeCollection } = require('../helpers/mongodb/fake-collection.js');
const { sourceContract } = require('../helpers/queue/source-contract.js');

sourceContract('memory', async ({ now }) => ({ source: createMemoryQueue({ now }).source }));
sourceContract('mongodb', async ({ now }) => ({
  source: createMongoOutbox({ collection: fakeCollection(), now }).source,
}));
