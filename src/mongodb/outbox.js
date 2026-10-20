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
const { checkOptionalFunction, checkPositiveInteger } = require('../internal/options.js');
const { sleep } = require('../internal/sleep.js');
const {
  checkNonNegativeInteger,
  checkRetainData,
  retentionOf,
} = require('../internal/queue-options.js');
const { isJobRequest, rankOf } = require('../internal/priority.js');
const { checkCollection, documentOf, sessionOf } = require('./collection.js');

// The documents of the pauses, of the whole queue and of one tenant's jobs:
// their ids in one range of _id, which no job id, with no colon, falls in.
const PAUSE_ID = 'mailer:pause';
const pauseIdOf = (tenantId) => (tenantId === undefined ? PAUSE_ID : `${PAUSE_ID}:${tenantId}`);
const PAUSES = { _id: { $gte: PAUSE_ID, $lt: `${PAUSE_ID};` } };
// The order of the ready jobs, and of those of one rank.
const READY_ORDER = { rank: 1, availableAt: 1, enqueuedAt: 1 };
const RANK_ORDER = { availableAt: 1, enqueuedAt: 1 };
const FAIRNESS = new Set(['none', 'tenant']);
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
  // Null for none, so that an index and a filter of tenants take it as one.
  tenantId: request.tenantId ?? null,
  updatedAt: new Date(now),
});

const jobOf = (document) => {
  const { _id: id } = document;
  const job = {
    id,
    name: document.name,
    data: document.data,
    attempt: document.attempts,
    maxAttempts: document.maxAttempts,
    enqueuedAt: document.enqueuedAt?.getTime?.(),
    redelivered: document.redelivered === true,
    redeliveries: document.redeliveries ?? 0,
  };
  if (typeof document.tenantId === 'string') job.tenantId = document.tenantId;
  return job;
};

// A job as the outbox holds it, for its readers.
const viewOf = (document) => ({
  ...jobOf(document),
  state: document.state,
  priority: document.priority,
  failure: document.failure,
  result: document.result,
});

// What the outbox holds: its jobs by state, how long the oldest job due has
// waited, and its pauses.
const statsOf = async (collection, source, nowMs) => {
  const now = new Date(nowMs);
  const counts = {};
  const filters = {
    ready: { state: 'ready', availableAt: { $lte: now } },
    delayed: { state: 'ready', availableAt: { $gt: now } },
    active: { state: 'active' },
    completed: { state: 'completed' },
    failed: { state: 'failed' },
  };
  for (const state of Object.keys(filters)) {
    counts[state] = await collection.countDocuments(filters[state]);
  }
  const oldest = await collection.findOne(filters.ready, {
    sort: { availableAt: 1 },
    projection: { availableAt: 1 },
  });
  const stats = { ...counts };
  if (oldest?.availableAt instanceof Date) {
    stats.oldestReadyMilliseconds = nowMs - oldest.availableAt.getTime();
  }
  const pauses = await source.pausesAt(nowMs);
  if (pauses.until > nowMs) stats.pausedUntil = pauses.until;
  if (pauses.tenants.length > 0) stats.pausedTenants = pauses.tenants;
  return stats;
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
  // When this process last took back the leases that ran out, and read the
  // pause of the queue: once a while, not on each reserve of each lane.
  #reclaimedAt = -Infinity;
  #pauses = { readAt: -Infinity, until: 0, tenants: new Map() };
  // The tenants with jobs ready, read once a poll interval, taken in turn.
  #tenants = { readAt: -Infinity, list: [], cursor: 0, found: false };

  constructor(collection, config) {
    this.#collection = collection;
    this.#config = config;
    if (config.changeStream) this.subscribe = (listener) => subscribe(collection, listener, config);
  }

  async #settle(lease, set, inc, dropData = false) {
    const update = {
      $set: { ...set, token: null, leaseUntil: null, updatedAt: new Date(this.#config.now()) },
    };
    if (inc !== undefined) update.$inc = inc;
    // The message is not kept once it is done with: its addresses, context
    // and a reset link among it. The hash stays, by which a duplicate is told.
    if (dropData) update.$unset = { data: '' };
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

  // The pauses, of the queue and of tenants: read again once a poll
  // interval, a pause of another process seen within it, one of this process
  // at once.
  async #readPauses(now) {
    if (now - this.#pauses.readAt < this.#config.pauseReadMilliseconds) return this.#pauses;
    const documents = await this.#collection
      // oxlint-disable-next-line no-restricted-properties -- a MongoDB collection, not an array
      .find(PAUSES, { projection: { pausedUntil: 1, tenantId: 1 } })
      .toArray();
    let until = 0;
    const tenants = new Map();
    for (const document of documents) {
      const at = document.pausedUntil instanceof Date ? document.pausedUntil.getTime() : 0;
      if (typeof document.tenantId === 'string') tenants.set(document.tenantId, at);
      else until = at;
    }
    this.#pauses = { readAt: now, until, tenants };
    return this.#pauses;
  }

  // The tenants whose jobs wait now, and when the first of them resumes.
  #pausedTenants(now) {
    const paused = [];
    let resumesAt;
    for (const [tenant, until] of this.#pauses.tenants) {
      if (until <= now) continue;
      paused.push(tenant);
      if (resumesAt === undefined || until < resumesAt) resumesAt = until;
    }
    return { paused, resumesAt };
  }

  // A job whose lease ran out is ready again, its attempt to run again: by
  // this worker's clock, as long ago as two clocks may be apart, lest a worker
  // whose clock is behind still holds it. Once a third of a lease, as a lease
  // cannot run out sooner, a write on the primary saved on every other poll.
  async #reclaim(now, leaseMilliseconds) {
    const every = Math.min(this.#config.leaseMilliseconds, leaseMilliseconds) / 3;
    if (now - this.#reclaimedAt < every) return;
    this.#reclaimedAt = now;
    const ranOut = new Date(now - this.#config.clockSkewToleranceMilliseconds);
    await this.#collection.updateMany(
      { state: 'active', leaseUntil: { $lte: ranOut } },
      {
        $set: { state: 'ready', token: null, leaseUntil: null, redelivered: true },
        $inc: { attempts: -1, redeliveries: 1 },
      },
    );
  }

  // Lends the first job a filter meets, in an order.
  async #take(filter, sort, now, leaseMilliseconds) {
    const token = randomUUID();
    const taken = documentOf(
      await this.#collection.findOneAndUpdate(
        filter,
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
        { sort, returnDocument: 'before', includeResultMetadata: false },
      ),
    );
    if (taken === null) return undefined;
    return { lease: { job: { ...jobOf(taken), attempt: taken.attempts + 1 }, token } };
  }

  // The tenants with jobs ready: read again once a poll interval, or when
  // those read are done with and some were found then.
  async #tenantsReady(ready, now, again) {
    const tenants = this.#tenants;
    const stale = now - tenants.readAt >= this.#config.pauseReadMilliseconds;
    if (stale || (again && tenants.found)) {
      const list = await this.#collection.distinct('tenantId', ready);
      this.#tenants = { readAt: now, list, cursor: 0, found: list.length > 0 };
    }
    return this.#tenants;
  }

  // A job by tenant in turn: a high one of any tenant first, a code of
  // sign-in waiting for no one's newsletter, then the tenants one after the
  // other, so that the backlog of one holds no other's mail.
  async #takeFairly(ready, paused, now, leaseMilliseconds) {
    const high = await this.#take({ ...ready, rank: 0 }, RANK_ORDER, now, leaseMilliseconds);
    if (high !== undefined) return high;
    for (let round = 0; round < 2; round++) {
      const tenants = await this.#tenantsReady(ready, now.getTime(), round > 0);
      while (tenants.list.length > 0) {
        const index = tenants.cursor % tenants.list.length;
        const tenant = tenants.list[index];
        // A tenant paused since its list was read waits.
        if (!paused.has(tenant)) {
          const filter = { state: 'ready', availableAt: ready.availableAt, tenantId: tenant };
          const taken = await this.#take(filter, READY_ORDER, now, leaseMilliseconds);
          if (taken !== undefined) {
            tenants.cursor = index + 1;
            return taken;
          }
        }
        // Nothing of this tenant is ready now.
        tenants.list.splice(index, 1);
        tenants.cursor = index;
      }
    }
    return undefined;
  }

  async reserve(leaseMilliseconds) {
    const now = new Date(this.#config.now());
    const pauses = await this.#readPauses(now.getTime());
    if (pauses.until > now.getTime()) return { nextAvailableAt: pauses.until };
    await this.#reclaim(now.getTime(), leaseMilliseconds);
    const { paused, resumesAt } = this.#pausedTenants(now.getTime());
    const ready = { state: 'ready', availableAt: { $lte: now } };
    if (paused.length > 0) ready.tenantId = { $nin: paused };
    const taken =
      this.#config.fairness === 'tenant'
        ? await this.#takeFairly(ready, new Set(paused), now, leaseMilliseconds)
        : await this.#take(ready, READY_ORDER, now, leaseMilliseconds);
    if (taken !== undefined) return taken;
    const waiting = { state: 'ready' };
    if (paused.length > 0) waiting.tenantId = { $nin: paused };
    const next = await this.#collection.findOne(waiting, {
      sort: { availableAt: 1 },
      projection: { availableAt: 1 },
    });
    let due = next?.availableAt instanceof Date ? next.availableAt.getTime() : undefined;
    if (resumesAt !== undefined && (due === undefined || resumesAt < due)) due = resumesAt;
    return due === undefined ? {} : { nextAvailableAt: due };
  }

  async extend(lease, leaseMilliseconds) {
    const result = await this.#collection.updateOne(leased(lease), {
      $set: { leaseUntil: new Date(this.#config.now() + leaseMilliseconds) },
    });
    return (result?.matchedCount ?? 0) > 0;
  }

  ack(lease, result) {
    const now = this.#config.now();
    const finishedAt = new Date(now);
    // Kept, and its key remembered, for the window of duplicates.
    const expireAt = new Date(now + this.#config.dedupeWindowSeconds * 1000);
    const set = { state: 'completed', result: result ?? null, finishedAt, expireAt };
    return this.#settle(lease, set, undefined, this.#config.retainData !== 'all');
  }

  retry(lease, availableAt, failure) {
    return this.#settle(lease, { state: 'ready', availableAt: new Date(availableAt), failure });
  }

  fail(lease, failure) {
    const now = this.#config.now();
    const finishedAt = new Date(now);
    const expireAt = new Date(now + this.#config.retainFailedSeconds * 1000);
    const set = { state: 'failed', failure, finishedAt, expireAt };
    return this.#settle(lease, set, undefined, this.#config.retainData === 'none');
  }

  release(lease, availableAt) {
    const at = new Date(availableAt ?? this.#config.now());
    return this.#settle(lease, { state: 'ready', availableAt: at }, { attempts: -1 });
  }

  async pause(until, scope = {}) {
    const { tenantId } = scope;
    const update = { $max: { pausedUntil: new Date(until) } };
    if (tenantId !== undefined) update.$set = { tenantId };
    await this.#collection.updateOne({ _id: pauseIdOf(tenantId) }, update, { upsert: true });
    if (tenantId === undefined) {
      this.#pauses.until = Math.max(this.#pauses.until, until);
    } else {
      const held = this.#pauses.tenants.get(tenantId) ?? 0;
      this.#pauses.tenants.set(tenantId, Math.max(held, until));
    }
  }

  // The pauses in force, read now: the queue's, and the tenants'.
  async pausesAt(now) {
    this.#pauses.readAt = -Infinity;
    const pauses = await this.#readPauses(now);
    const tenants = [];
    for (const [tenantId, until] of pauses.tenants) {
      if (until > now) tenants.push({ tenantId, until });
    }
    return { until: pauses.until, tenants };
  }

  async resume(scope = {}) {
    const { tenantId } = scope;
    await this.#collection.deleteOne({ _id: pauseIdOf(tenantId) });
    if (tenantId === undefined) this.#pauses.until = 0;
    else this.#pauses.tenants.delete(tenantId);
    // Its jobs are ready again: the tenants are read again.
    this.#tenants.readAt = -Infinity;
  }
}

// The changes after which a job may be ready: a job enqueued, retried, given
// back or whose lease was taken back. The outbox's own leases, extensions and
// settlings, most of its writes, wake no worker.
const READY_CHANGES = [
  {
    $match: {
      $or: [
        { operationType: 'insert', 'fullDocument.state': 'ready' },
        { operationType: 'update', 'updateDescription.updatedFields.state': 'ready' },
        { operationType: 'replace', 'fullDocument.state': 'ready' },
      ],
    },
  },
];
const MAX_RESUBSCRIBE_MS = 30_000;

const closeStream = async (stream) => {
  try {
    await stream.close();
  } catch {
    // Closed already, or the connection is gone: nothing to close.
  }
};

// Wakes the readers on a change of the collection, where MongoDB has change
// streams (a replica set); the polling goes on without them. A stream that
// fails (a failover the driver could not resume) is opened again, a second
// later, then up to every 30 seconds.
const subscribe = (collection, listener, config) => {
  const stopped = new AbortController();
  let stream;
  let failures = 0;
  // Closes a stream that failed and opens another after the wait.
  const reopen = async (current) => {
    if (stream === current) stream = undefined;
    await closeStream(current);
    const delay = Math.min(MAX_RESUBSCRIBE_MS, 1000 * 2 ** failures);
    failures += 1;
    try {
      await config.sleep(delay, stopped.signal);
    } catch {
      return;
    }
    open();
  };
  const open = () => {
    if (stopped.signal.aborted) return;
    const current = collection.watch(READY_CHANGES, { fullDocument: 'default' });
    stream = current;
    let failed = false;
    current.on('change', () => {
      failures = 0;
      listener();
    });
    current.on('error', (error) => {
      if (failed) return;
      failed = true;
      config.log.write(
        'warn',
        () => ({ error: error?.message, failures }),
        'queue.change_stream_failed',
      );
      reopen(current);
    });
  };
  open();
  return () => {
    stopped.abort();
    if (stream !== undefined) closeStream(stream);
  };
};

// The options of an outbox, checked.
const createOutboxConfig = (options) => {
  const fairness = options.fairness ?? 'none';
  if (!FAIRNESS.has(fairness)) throw new TypeError("fairness must be 'none' or 'tenant'.");
  const collection = checkCollection(options.collection, 'createMongoOutbox');
  if (fairness === 'tenant' && typeof collection.distinct !== 'function') {
    throw new TypeError("fairness 'tenant' needs a collection with distinct().");
  }
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
  return {
    collection,
    now: checkOptionalFunction(options.now, 'now') ?? Date.now,
    sleep: checkOptionalFunction(options.sleep, 'sleep') ?? sleep,
    // The polling driver checks it; the pause is read again as often.
    pauseReadMilliseconds: options.pollIntervalMilliseconds ?? 1000,
    fairness,
    // The lease of the workers: none of theirs runs out sooner.
    leaseMilliseconds: options.leaseMilliseconds ?? DEFAULT_LEASE_MS,
    retainData: checkRetainData(options.retainData),
    clockSkewToleranceMilliseconds,
    changeStream,
    ...retentionOf(options),
    log: createLog(options.logger, { component: 'queue', queue: 'mongodb' }),
  };
};

// What the outbox holds, for its readers: a job, the counts, the failed jobs
// and a retry of one by hand.
const readersOf = (collection, source, config) => ({
  async get(id) {
    const document = await collection.findOne({ _id: id });
    // The pauses of the queue are no jobs.
    if (document === null || document === undefined || id.startsWith(PAUSE_ID)) return undefined;
    return viewOf(document);
  },
  stats: () => statsOf(collection, source, config.now()),
  async failed(failedOptions = {}) {
    const limit = checkPositiveInteger(failedOptions.limit ?? 100, 'limit');
    const filter =
      failedOptions.after === undefined
        ? { state: 'failed' }
        : { state: 'failed', _id: { $gt: failedOptions.after } };
    const documents = await collection
      // oxlint-disable-next-line no-restricted-properties -- a MongoDB collection, not an array
      .find(filter)
      .sort({ _id: 1 })
      .limit(limit)
      .toArray();
    const jobs = [];
    for (const document of documents) jobs.push(viewOf(document));
    return jobs;
  },
  async retryFailed(id) {
    const held = await collection.findOne({ _id: id }, { projection: { state: 1, data: 1 } });
    if (held?.state !== 'failed') return false;
    if (held.data === undefined) {
      throw new TypeError(`The job ${id} keeps no data to send again: retainData dropped it.`);
    }
    const now = new Date(config.now());
    const result = await collection.updateOne(
      { _id: id, state: 'failed' },
      {
        $set: {
          state: 'ready',
          availableAt: now,
          attempts: 0,
          redeliveries: 0,
          redelivered: false,
          updatedAt: now,
        },
        $unset: { failure: '', finishedAt: '', expireAt: '' },
      },
    );
    return (result?.matchedCount ?? 0) > 0;
  },
});

/**
 * Makes a mail queue in a collection of MongoDB.
 *
 * @param options `collection`, `db.collection('mail_outbox')`;
 * `changeStream` (false), to wake the workers on a change (a replica set);
 * `retainData` ('failed'), the finished jobs whose data is kept; `fairness`
 * ('none'), or 'tenant' for the tenants' jobs in turn;
 * `dedupeWindowSeconds` (a day), the time a completed job is kept, and so
 * the window of its duplicates; `retainFailedSeconds` (a week), that of a
 * failed one; `clockSkewToleranceMilliseconds` (5000), how
 * far the clocks of the workers may be apart; `now`, `logger`, and the
 * options of the polling driver.
 * @returns The driver, with `source`, `ensureIndexes()` and `get(id)`.
 * @throws {TypeError} If an option is invalid.
 */
const createMongoOutbox = (options = {}) => {
  const config = createOutboxConfig(options);
  const { collection } = config;
  const source = new MongoOutboxSource(collection, config);
  const driver = createPollingDriver(source, { ...options, now: config.now });
  return {
    ...driver,
    // An enqueue writes in the transaction it is given.
    transactional: true,
    source,
    resume: (scope) => source.resume(scope),
    async ensureIndexes() {
      await collection.createIndex(
        { state: 1, rank: 1, availableAt: 1, enqueuedAt: 1 },
        { name: 'mailer_ready' },
      );
      await collection.createIndex({ state: 1, leaseUntil: 1 }, { name: 'mailer_leases' });
      // When the next job is due, read when none is: sorted by time alone,
      // which the index of the ready jobs, by priority first, cannot give.
      await collection.createIndex({ state: 1, availableAt: 1 }, { name: 'mailer_due' });
      // The tenants with jobs ready, and the jobs of one, for fairness.
      await collection.createIndex(
        { state: 1, tenantId: 1, rank: 1, availableAt: 1, enqueuedAt: 1 },
        { name: 'mailer_tenant' },
      );
      // A finished job goes at its time, a completed one and with it the
      // memory of its key after the window of duplicates, a failed one later.
      await collection.createIndex(
        { expireAt: 1 },
        { name: 'mailer_expire', expireAfterSeconds: 0 },
      );
    },
    ...readersOf(collection, source, config),
  };
};

module.exports = { PAUSE_ID, createMongoOutbox };
