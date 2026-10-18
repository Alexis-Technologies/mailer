// Not ported: an audit sink in a collection of MongoDB: append-only, each
// event written once by its id however often it is told, and in the
// transaction of the enqueue when there is one.

const { rankOf, stateOf } = require('../audit/states.js');
const { checkCollection, sessionOf } = require('./collection.js');

// An event as a document: its id the key, its time a Date, and the rank of
// its state, which orders the events of one time and attempt.
const documentOfEvent = (event) => {
  const { id, at, ...rest } = event;
  return { _id: id, ...rest, at: new Date(at), rank: rankOf(event.state) };
};

const eventOfDocument = (document) => {
  const { _id, at, rank, ...rest } = document;
  return { id: _id, ...rest, at: at instanceof Date ? at.toISOString() : at };
};

/**
 * Makes an audit sink in a collection.
 *
 * @param options `collection`, `db.collection('mail_audit')`.
 * @returns The sink, with `has(id)`, `eventsOf(correlationId)`,
 * `stateOf(correlationId)` and `ensureIndexes()`.
 * @throws {TypeError} If it is given no collection.
 */
const createMongoAuditSink = (options = {}) => {
  const collection = checkCollection(options.collection, 'createMongoAuditSink', [
    'updateOne',
    'findOne',
    'find',
    'createIndex',
  ]);
  const eventsOf = async (correlationId) => {
    const documents = await collection
      // oxlint-disable-next-line no-restricted-properties -- a MongoDB collection, not an array
      .find({ correlationId })
      .sort({ at: 1, attempt: 1, rank: 1 })
      .toArray();
    const events = [];
    for (const document of documents) events.push(eventOfDocument(document));
    return events;
  };
  return {
    async has(id) {
      const found = await collection.findOne({ _id: id }, { projection: { _id: 1 } });
      return found !== null && found !== undefined;
    },
    async append(event, context) {
      if (typeof event?.id !== 'string') throw new TypeError('An audit event has an id.');
      await collection.updateOne(
        { _id: event.id },
        { $setOnInsert: documentOfEvent(event) },
        { ...sessionOf(context?.transaction), upsert: true },
      );
    },
    // A batch in one round trip, each event written once by its id.
    async appendMany(events, context) {
      const operations = [];
      for (const event of events) {
        if (typeof event?.id !== 'string') throw new TypeError('An audit event has an id.');
        operations.push({
          updateOne: {
            filter: { _id: event.id },
            update: { $setOnInsert: documentOfEvent(event) },
            upsert: true,
          },
        });
      }
      if (operations.length === 0) return;
      if (typeof collection.bulkWrite !== 'function') {
        for (const event of events) await this.append(event, context);
        return;
      }
      await collection.bulkWrite(operations, {
        ...sessionOf(context?.transaction),
        ordered: false,
      });
    },
    eventsOf,
    stateOf: async (correlationId) => stateOf(await eventsOf(correlationId)),
    async ensureIndexes() {
      await collection.createIndex(
        { correlationId: 1, at: 1, attempt: 1, rank: 1 },
        { name: 'mailer_correlation' },
      );
      await collection.createIndex({ jobId: 1 }, { name: 'mailer_job', sparse: true });
    },
  };
};

module.exports = { createMongoAuditSink };
