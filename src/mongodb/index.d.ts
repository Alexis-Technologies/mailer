// Not ported: the types of ./mongodb. The MongoDB driver is not a dependency
// of any kind: you pass in its collections, which these name by the members
// the stores call, so that this file resolves without it. Methods use
// shorthand, compared bivariantly, so that the driver's generic and
// overloaded signatures satisfy them without being imported.

import type {
  AuditEvent,
  AuditSink,
  Logger,
  MessageState,
  QueueDriver,
  QueueSource,
} from '../../index.js';
import type { IdempotencyStore } from '../idempotency/index.js';
import type { PollingDriverOptions } from '../queue/index.js';

/** What a write of a collection gives. */
export interface MongoUpdateResultLike {
  readonly matchedCount: number;
  readonly upsertedCount?: number;
}

/** A cursor of `find()`. */
export interface MongoCursorLike {
  sort(sort: any): MongoCursorLike;
  toArray(): Promise<any[]>;
}

/** A change stream of `watch()`. */
export interface MongoChangeStreamLike {
  on(event: string, listener: (...args: any[]) => void): unknown;
  close(): Promise<unknown>;
}

/** The members of a `Collection` of the MongoDB driver the stores call. */
export interface MongoCollectionLike {
  updateOne(filter: any, update: any, options?: any): Promise<MongoUpdateResultLike>;
  updateMany(filter: any, update: any, options?: any): Promise<unknown>;
  findOne(filter: any, options?: any): Promise<any>;
  findOneAndUpdate(filter: any, update: any, options: any): Promise<any>;
  deleteOne(filter: any, options?: any): Promise<unknown>;
  find(filter: any, options?: any): MongoCursorLike;
  createIndex(spec: any, options?: any): Promise<string>;
  /** For `changeStream: true`, on a replica set. */
  watch?(pipeline?: any[], options?: any): MongoChangeStreamLike;
}

/** The options of {@link createMongoOutbox}. */
export interface MongoOutboxOptions extends PollingDriverOptions {
  /** `db.collection('mail_outbox')`. */
  readonly collection: MongoCollectionLike;
  /** Wakes the workers on a change of the collection, on a replica set. @default false */
  readonly changeStream?: boolean;
  /**
   * How far the clocks of the workers may be apart: a lease is taken back
   * only that long after it ran out. The lease must be more than three times
   * longer. @default 5000
   */
  readonly clockSkewToleranceMilliseconds?: number;
  /** The time a completed job is kept, and so the window of its duplicates. @default 86400 */
  readonly dedupeWindowSeconds?: number;
  /** The time a failed job is kept, for a retry by hand. @default 604800 */
  readonly retainFailedSeconds?: number;
  /** The finished jobs whose data is kept: the others keep their version and hash. @default 'failed' */
  readonly retainData?: 'all' | 'failed' | 'none';
  readonly logger?: Logger;
}

/** A job of the outbox, as it holds it. */
export interface MongoOutboxJob {
  readonly id: string;
  readonly name: string;
  readonly data: any;
  readonly state: 'ready' | 'active' | 'completed' | 'failed';
  readonly priority: 'high' | 'normal' | 'low';
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly enqueuedAt?: number;
  readonly redelivered: boolean;
  readonly failure?: { readonly code: string; readonly reason: string };
  readonly result?: any;
}

/** The mail queue in a collection: a driver, its source, and what it holds. */
export interface MongoOutbox extends QueueDriver {
  readonly transactional: true;
  readonly source: QueueSource;
  /** Makes the indexes of the outbox: the ready jobs, the leases, the next one due, and the expiry of finished ones (`expireAt`). */
  ensureIndexes(): Promise<void>;
  get(id: string): Promise<MongoOutboxJob | undefined>;
}

/**
 * Makes a mail queue in a collection of MongoDB, the transactional outbox:
 * a job enqueued with `{ transaction: session }` is written in that
 * transaction, its `queued` audit event too.
 *
 * @example
 * ```js
 * const outbox = createMongoOutbox({ collection: db.collection('mail_outbox') });
 * await outbox.ensureIndexes();
 * const queue = createMailQueue({ driver: outbox, audit });
 * await session.withTransaction(async () => {
 *   await users.updateOne({ _id }, { $set: { resetToken } }, { session });
 *   await queue.enqueue(job, { transaction: session });
 * });
 * ```
 * @throws {TypeError} If an option is invalid.
 */
export declare function createMongoOutbox(options: MongoOutboxOptions): MongoOutbox;

/** The options of {@link createMongoAuditSink}. */
export interface MongoAuditSinkOptions {
  /** `db.collection('mail_audit')`. */
  readonly collection: MongoCollectionLike;
}

/** An audit sink in a collection. */
export interface MongoAuditSink extends AuditSink {
  append(event: AuditEvent, context?: { readonly transaction?: unknown }): Promise<void>;
  has(id: string): Promise<boolean>;
  eventsOf(correlationId: string): Promise<readonly AuditEvent[]>;
  stateOf(correlationId: string): Promise<MessageState | undefined>;
  /** Makes the indexes of the events: by correlation id and time, by job. */
  ensureIndexes(): Promise<void>;
}

/**
 * Makes an audit sink in a collection: append-only, each event written once
 * by its id, in the transaction it is given.
 *
 * @throws {TypeError} If it is given no collection.
 */
export declare function createMongoAuditSink(options: MongoAuditSinkOptions): MongoAuditSink;

/** The options of {@link createMongoIdempotencyStore}. */
export interface MongoIdempotencyStoreOptions {
  /** `db.collection('mail_idempotency')`. */
  readonly collection: MongoCollectionLike;
  readonly now?: () => number;
}

/** A store of idempotency keys in a collection. */
export interface MongoIdempotencyStore extends IdempotencyStore {
  /** Makes the index that drops a key once its time has passed. */
  ensureIndexes(): Promise<void>;
}

/**
 * Makes a store of idempotency keys in a collection, which the workers of
 * several processes share, for `IdempotencyTransport`.
 *
 * @throws {TypeError} If an option is invalid.
 */
export declare function createMongoIdempotencyStore(
  options: MongoIdempotencyStoreOptions,
): MongoIdempotencyStore;
