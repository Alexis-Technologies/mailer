// Not ported: the contract of a QueueSource held by the memory queue and by
// the MongoDB outbox on a collection in memory (tests/mongodb holds it on
// MongoDB itself).
const { createMongoOutbox } = require('../../src/mongodb/index.js');
const { createMemoryQueue } = require('../../src/queue/index.js');
const { fakeCollection } = require('../helpers/mongodb/fake-collection.js');
const { sourceContract } = require('../helpers/queue/source-contract.js');

sourceContract('memory', async ({ now, fairness }) => ({
  source: createMemoryQueue({ now, fairness }).source,
}));
sourceContract('mongodb', async ({ now, fairness }) => ({
  source: createMongoOutbox({ collection: fakeCollection(), now, fairness }).source,
}));

// Fairness among tenants keeps every other rule of a source.
sourceContract(
  'memory, tenants in turn',
  async ({ now }) => ({ source: createMemoryQueue({ now, fairness: 'tenant' }).source }),
  { fairness: 'tenant' },
);
sourceContract(
  'mongodb, tenants in turn',
  async ({ now }) => ({
    source: createMongoOutbox({ collection: fakeCollection(), now, fairness: 'tenant' }).source,
  }),
  { fairness: 'tenant' },
);
