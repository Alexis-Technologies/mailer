import { expectAssignable, expectError, expectType } from 'tsd';
import { MongoClient, type Collection } from 'mongodb';
import type { MessageState, QueueDriver } from '../../index.js';
import { IdempotencyTransport, type IdempotencyStore } from '../../src/idempotency/index.js';
import { createMailQueue } from '../../src/queue/index.js';
import {
  createMongoAuditSink,
  createMongoIdempotencyStore,
  createMongoOutbox,
  type MongoAuditSink,
  type MongoCollectionLike,
  type MongoOutbox,
  type MongoOutboxJob,
} from '../../src/mongodb/index.js';
import type { Transport } from '../../index.js';

// The collections of the real driver fit the structural type.
const client = new MongoClient('mongodb://localhost:27017');
const db = client.db('app');
expectAssignable<MongoCollectionLike>(db.collection('mail_outbox'));
declare const typed: Collection<{ _id: string; state: string }>;
expectAssignable<MongoCollectionLike>(typed);

const outbox = createMongoOutbox({
  collection: db.collection('mail_outbox'),
  changeStream: true,
  dedupeWindowSeconds: 3600,
  leaseMilliseconds: 30_000,
  pollIntervalMilliseconds: 500,
});
expectType<MongoOutbox>(outbox);
expectAssignable<QueueDriver>(outbox);
expectType<Promise<void>>(outbox.ensureIndexes());
expectType<Promise<MongoOutboxJob | undefined>>(outbox.get('id'));
expectError(createMongoOutbox({}));

const audit = createMongoAuditSink({ collection: db.collection('mail_audit') });
expectType<MongoAuditSink>(audit);
expectType<Promise<MessageState | undefined>>(audit.stateOf('c'));
const store = createMongoIdempotencyStore({
  collection: db.collection('mail_idempotency'),
  now: Date.now,
});
expectAssignable<IdempotencyStore>(store);

declare const transport: Transport;
const queue = createMailQueue({ driver: outbox, audit });
const session = client.startSession();
await queue.enqueue(
  {
    kind: 'content',
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 's',
    content: { text: 't' },
  },
  { transaction: session },
);
queue.createWorker({ transport: new IdempotencyTransport(transport, { store }) });
