// Not ported: a mail queue in a collection of MongoDB, the transactional
// outbox: a job is written in the transaction of the application's own
// writes, so that a message is queued exactly when what it tells of is
// committed, with no Redis.  It is a QueueSource, which the polling driver
// reads: a job is lent by one atomic findOneAndUpdate, under a token every
// later write is fenced by, and a job whose lease ran out goes to another
// worker.

const { randomUUID } = require('node:crypto');
const { createPollingDriver } = require('../internal/polling-driver.js');
const { createLog } = require('../internal/log.js');
const {
  checkNonNegativeInteger,
  checkOptionalFunction,
  checkPositiveInteger,
} = require('../internal/options.js');
const { isJobRequest, rankOf } = require('../internal/priority.js');
const { checkCollection, documentOf, sessionOf } = require('./collection.js');

// The document of a pause of the whole queue: no job id has a colon.
const PAUSE_ID = 'mailer:pause';
const DEFAULT_RETAIN_SECONDS = 7 * 24 * 60 * 60;
// How far the clocks of two workers may be apart: a lease is taken back only
// that long after it ran out by the clock of the worker that takes it.
const DEFAULT_CLOCK_SKEW_MS = 5000;
const DEFAULT_LEASE_MS = 60_000;

// A job id has no colon, which the pause's id has.
const isRequest = (request) => isJobRequest(request) && !request.id.includes(':');

const documentOfRequest = (request, now) => ({
  _id: request.id,
  name: request.name,
  data: request.data,
  hash: request.hash,
  priority: request.priority,
  rank: rankOf(request.priority),
  maxAttempts: request.maxAttempts,
  enqueuedAt: new Date(request.enqueuedAt ?? now),
  availableAt: new Date(request.availableAt ?? request.enqueuedAt ?? now),
  state: 'ready',
  attempts: 0,
  redelivered: false,
  // The runs that did not finish, never counted down, unlike attempts.
  redeliveries: 0,
  token: null,
  leaseUntil: null,
  updatedAt: new Date(now),
});

const jobOf = (document) => {
  const { _id: id } = document;
  return {
    id,
    name: document.name,
    data: document.data,
    attempt: document.attempts,
    maxAttempts: document.maxAttempts,
    enqueuedAt: document.enqueuedAt?.getTime?.(),
    redelivered: document.redelivered === true,
    redeliveries: document.redeliveries ?? 0,
  };
};

// The filter of a write under a lease: the job is still lent to it.
const leased = (lease) => ({ _id: lease.job.id, token: lease.token, state: 'active' });

/**
 * The source of an outbox in a collection.
 *
 * @internal
 */
class MongoOutboxSource {
  id = 'mongodb';
  #collection;
  #config;

  constructor(collection, config) {
    this.#collection = collection;
    this.#config = config;
    if (config.changeStream) this.subscribe = (listener) => subscribe(collection, listener, config);
  }

  async #settle(lease, set, inc) {
    const update = {
      $set: { ...set, token: null, leaseUntil: null, updatedAt: new Date(this.#config.now()) },
    };
    if (inc !== undefined) update.$inc = inc;
    const result = await this.#collection.updateOne(leased(lease), update);
    // false: the lease was lost, and the job is another worker's.
    return (result?.matchedCount ?? 0) > 0;
  }

  async enqueue(request, options = {}) {
    if (!isRequest(request)) throw new TypeError('The MongoDB outbox takes a job request.');
    // An upsert, not an insert: a duplicate key would abort the transaction
    // of the application.
    const session = sessionOf(options.transaction);
    const result = await this.#collection.updateOne(
      { _id: request.id },
      { $setOnInsert: documentOfRequest(request, this.#config.now()) },
      { ...session, upsert: true },
    );
    if ((result?.upsertedCount ?? 0) > 0) return { id: request.id, duplicate: false };
    const held = await this.#collection.findOne(
      { _id: request.id },
      { ...session, projection: { hash: 1 } },
    );
    const answer = { id: request.id, duplicate: true };
    if (typeof held?.hash === 'string') answer.existingHash = held.hash;
    return answer;
  }

  async #paused(now) {
    const pause = await this.#collection.findOne(
      { _id: PAUSE_ID },
      { projection: { pausedUntil: 1 } },
    );
    const until = pause?.pausedUntil;
    return until instanceof Date && until > now ? until : undefined;
  }

  async reserve(leaseMilliseconds) {
    const now = new Date(this.#config.now());
    const paused = await this.#paused(now);
    if (paused !== undefined) return { nextAvailableAt: paused.getTime() };
    // A job whose lease ran out is ready again, its attempt to run again:
    // by this worker's clock, as long ago as two clocks may be apart, lest a
    // worker whose clock is behind still holds it.
    const ranOut = new Date(now.getTime() - this.#config.clockSkewToleranceMilliseconds);
    await this.#collection.updateMany(
      { state: 'active', leaseUntil: { $lte: ranOut } },
      {
        $set: { state: 'ready', token: null, leaseUntil: null, redelivered: true },
        $inc: { attempts: -1, redeliveries: 1 },
      },
    );
    const token = randomUUID();
    const taken = documentOf(
      await this.#collection.findOneAndUpdate(
        { state: 'ready', availableAt: { $lte: now } },
        {
          $set: {
            state: 'active',
            token,
            leaseUntil: new Date(now.getTime() + leaseMilliseconds),
            redelivered: false,
            updatedAt: now,
          },
          $inc: { attempts: 1 },
        },
        // As it was: whether it comes back, and its attempt before this one.
        {
          sort: { rank: 1, availableAt: 1, enqueuedAt: 1 },
          returnDocument: 'before',
          includeResultMetadata: false,
        },
      ),
    );
    if (taken !== null) {
      return { lease: { job: { ...jobOf(taken), attempt: taken.attempts + 1 }, token } };
    }
    const next = await this.#collection.findOne(
      { state: 'ready' },
      { sort: { availableAt: 1 }, projection: { availableAt: 1 } },
    );
    return next?.availableAt instanceof Date ? { nextAvailableAt: next.availableAt.getTime() } : {};
  }

  async extend(lease, leaseMilliseconds) {
    const result = await this.#collection.updateOne(leased(lease), {
      $set: { leaseUntil: new Date(this.#config.now() + leaseMilliseconds) },
    });
    return (result?.matchedCount ?? 0) > 0;
  }

  ack(lease, result) {
    const finishedAt = new Date(this.#config.now());
    return this.#settle(lease, { state: 'completed', result: result ?? null, finishedAt });
  }

  retry(lease, availableAt, failure) {
    return this.#settle(lease, { state: 'ready', availableAt: new Date(availableAt), failure });
  }

  fail(lease, failure) {
    const finishedAt = new Date(this.#config.now());
    return this.#settle(lease, { state: 'failed', failure, finishedAt });
  }

  release(lease, availableAt) {
    const at = new Date(availableAt ?? this.#config.now());
    return this.#settle(lease, { state: 'ready', availableAt: at }, { attempts: -1 });
  }

  async pause(until) {
    await this.#collection.updateOne(
      { _id: PAUSE_ID },
      { $max: { pausedUntil: new Date(until) } },
      { upsert: true },
    );
  }
}

// Wakes the readers on a change of the collection, where MongoDB has change
// streams (a replica set); the polling goes on without them.
const subscribe = (collection, listener, config) => {
  const stream = collection.watch(
    [{ $match: { operationType: { $in: ['insert', 'update', 'replace'] } } }],
    { fullDocument: 'default' },
  );
  stream.on('change', () => listener());
  stream.on('error', (error) => {
    config.log.write('warn', () => ({ error: error?.message }), 'queue.change_stream_failed');
  });
  return () => {
    stream.close().catch(() => {});
  };
};

/**
 * Makes a mail queue in a collection of MongoDB.
 *
 * @param options `collection`, `db.collection('mail_outbox')`;
 * `changeStream` (false), to wake the workers on a change (a replica set);
 * `retainFinishedSeconds` (7 days), the time a finished job is kept, and so
 * the window of its duplicates; `clockSkewToleranceMilliseconds` (5000), how
 * far the clocks of the workers may be apart; `now`, `logger`, and the
 * options of the polling driver.
 * @returns The driver, with `source`, `ensureIndexes()` and `get(id)`.
 * @throws {TypeError} If an option is invalid.
 */
const createMongoOutbox = (options = {}) => {
  const collection = checkCollection(options.collection, 'createMongoOutbox');
  const changeStream = options.changeStream ?? false;
  if (typeof changeStream !== 'boolean') throw new TypeError('changeStream must be a boolean.');
  if (changeStream && typeof collection.watch !== 'function') {
    throw new TypeError('changeStream needs a collection with watch().');
  }
  const clockSkewToleranceMilliseconds = checkNonNegativeInteger(
    options.clockSkewToleranceMilliseconds ?? DEFAULT_CLOCK_SKEW_MS,
    'clockSkewToleranceMilliseconds',
  );
  // A lease shorter than the skew would be extended within the skew.
  if ((options.leaseMilliseconds ?? DEFAULT_LEASE_MS) <= 3 * clockSkewToleranceMilliseconds) {
    throw new TypeError(
      'leaseMilliseconds must be more than 3 times clockSkewToleranceMilliseconds.',
    );
  }
  const config = {
    now: checkOptionalFunction(options.now, 'now') ?? Date.now,
    clockSkewToleranceMilliseconds,
    changeStream,
    retainFinishedSeconds: checkPositiveInteger(
      options.retainFinishedSeconds ?? DEFAULT_RETAIN_SECONDS,
      'retainFinishedSeconds',
    ),
    log: createLog(options.logger, { component: 'queue', queue: 'mongodb' }),
  };
  const source = new MongoOutboxSource(collection, config);
  const driver = createPollingDriver(source, { ...options, now: config.now });
  return {
    ...driver,
    source,
    async ensureIndexes() {
      await collection.createIndex(
        { state: 1, rank: 1, availableAt: 1, enqueuedAt: 1 },
        { name: 'mailer_ready' },
      );
      await collection.createIndex({ state: 1, leaseUntil: 1 }, { name: 'mailer_leases' });
      // A finished job goes after its time, and with it the memory of its key.
      await collection.createIndex(
        { finishedAt: 1 },
        { name: 'mailer_finished', expireAfterSeconds: config.retainFinishedSeconds },
      );
    },
    async get(id) {
      const document = await collection.findOne({ _id: id });
      // The pause of the queue is no job.
      if (document === null || document === undefined || id === PAUSE_ID) return undefined;
      const job = jobOf(document);
      return {
        ...job,
        state: document.state,
        priority: document.priority,
        failure: document.failure,
        result: document.result,
      };
    },
  };
};

module.exports = { PAUSE_ID, createMongoOutbox };
