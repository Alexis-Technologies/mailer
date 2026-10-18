// Not ported: a queue in memory, for tests and a single process: the source
// the polling driver reads, with the semantics a store's outbox has: jobs by
// priority, then time, then order; a lease per run, its attempt counted; a job
// whose lease ran out comes back as redelivered; an id is a duplicate while
// its job is kept. Its jobs are on heaps, so that a reserve costs O(log n)
// however many wait.

const { randomUUID } = require('node:crypto');
const { Heap } = require('../internal/heap.js');
const { createPollingDriver } = require('../internal/polling-driver.js');
const { checkOptionalFunction, checkPositiveInteger } = require('../internal/options.js');
const { checkRetainData, retentionOf } = require('../internal/queue-options.js');
const { isJobRequest, rankOf } = require('../internal/priority.js');

// The data of a job as a store gives it back: a copy, never the object
// enqueued.
const stored = (data) => JSON.parse(JSON.stringify(data));

// Of two ready jobs, whether `a` runs before `b`: by priority, then time,
// then order.
const readyBefore = (a, b) => {
  if (a.rank !== b.rank) return a.rank < b.rank;
  if (a.availableAt !== b.availableAt) return a.availableAt < b.availableAt;
  return a.seq < b.seq;
};
const dueBefore = (a, b) =>
  a.availableAt < b.availableAt || (a.availableAt === b.availableAt && a.seq < b.seq);
const leaseBefore = (a, b) => a.leaseUntil < b.leaseUntil;

// A node of a heap: what its job was when it was pushed. It is stale once the
// job changed since (its version), and is then skipped when it comes up.
const nodeOf = (entry) => ({
  entry,
  version: entry.version,
  rank: entry.rank,
  availableAt: entry.availableAt,
  seq: entry.seq,
  leaseUntil: entry.leaseUntil,
});

const isCurrent = (node, state) =>
  node.version === node.entry.version && node.entry.state === state;

// A list of the ids of finished jobs, the oldest at its head, taken from the
// head without shifting the array.
const finishedList = () => ({ ids: [], head: 0 });
const sizeOf = (list) => list.ids.length - list.head;
const headOf = (list) => (list.head < list.ids.length ? list.ids[list.head] : undefined);
const dropHead = (list) => {
  list.ids[list.head] = undefined;
  list.head += 1;
  if (list.head > 1024 && list.head * 2 > list.ids.length) {
    list.ids = list.ids.slice(list.head);
    list.head = 0;
  }
};

class MemorySource {
  id = 'memory';
  jobs = new Map();
  // The jobs waiting, by when they are due; those due, by the order they run
  // in; and the leases, by when they run out.
  #delayed = new Heap(dueBefore);
  #ready = new Heap(readyBefore);
  #leases = new Heap(leaseBefore);
  #open = 0;
  #active = 0;
  // The jobs finished, kept for different times: a completed one for the
  // window of its duplicates, a failed one for a retry by hand.
  #completed = finishedList();
  #failed = finishedList();
  #listeners = new Set();
  #waiters = new Set();
  #seq = 0;
  #finishedSeq = 0;
  #pausedUntil = 0;
  #config;

  constructor(config) {
    this.#config = config;
  }

  #notify() {
    for (const listener of this.#listeners) listener();
    for (const waiter of this.#waiters) waiter();
  }

  // A job waits again, its earlier nodes stale.
  #wait(entry) {
    entry.state = 'waiting';
    entry.token = undefined;
    entry.version += 1;
    this.#delayed.push(nodeOf(entry));
  }

  #finish(entry, state) {
    const now = this.#config.now();
    entry.state = state;
    entry.token = undefined;
    entry.version += 1;
    this.#active -= 1;
    this.#open -= 1;
    entry.finishedSeq = this.#finishedSeq++;
    const completed = state === 'completed';
    const seconds = completed ? this.#config.dedupeWindowSeconds : this.#config.retainFailedSeconds;
    entry.expireAt = now + seconds * 1000;
    (completed ? this.#completed : this.#failed).ids.push(entry.id);
    this.#sweep(now);
    this.#notify();
  }

  // Drops the finished jobs whose time is up, then the oldest beyond the
  // count kept, the memory of their keys with them.
  #sweep(now) {
    this.#expireList(this.#completed, now);
    this.#expireList(this.#failed, now);
    while (sizeOf(this.#completed) + sizeOf(this.#failed) > this.#config.retainFinished) {
      const completed = this.jobs.get(headOf(this.#completed));
      const failed = this.jobs.get(headOf(this.#failed));
      const older =
        failed === undefined ||
        (completed !== undefined && completed.finishedSeq < failed.finishedSeq)
          ? this.#completed
          : this.#failed;
      this.jobs.delete(headOf(older));
      dropHead(older);
    }
  }

  // Drops the finished jobs whose time is up: what the queue holds is read
  // only after.
  prune() {
    this.#sweep(this.#config.now());
  }

  #expireList(list, now) {
    for (;;) {
      const id = headOf(list);
      if (id === undefined) return;
      const entry = this.jobs.get(id);
      if (entry !== undefined && entry.expireAt > now) return;
      this.jobs.delete(id);
      dropHead(list);
    }
  }

  #holds(lease) {
    const entry = this.jobs.get(lease?.job?.id);
    const held = entry !== undefined && entry.state === 'active' && entry.token === lease.token;
    return held ? entry : undefined;
  }

  // A job whose lease ran out comes back, its attempt run again.
  #expire(now) {
    for (;;) {
      const node = this.#leases.peek();
      if (node === undefined || node.leaseUntil > now) return;
      this.#leases.pop();
      if (!isCurrent(node, 'active')) continue;
      const { entry } = node;
      entry.attempt -= 1;
      entry.redelivered = true;
      entry.redeliveries += 1;
      this.#active -= 1;
      this.#wait(entry);
    }
  }

  // The jobs that came due go from the delayed heap to the ready one.
  #promote(now) {
    for (;;) {
      const node = this.#delayed.peek();
      if (node === undefined) return;
      const current = isCurrent(node, 'waiting');
      if (current && node.availableAt > now) return;
      this.#delayed.pop();
      if (current) this.#ready.push(node);
    }
  }

  #nextReady() {
    for (;;) {
      const node = this.#ready.peek();
      if (node === undefined || isCurrent(node, 'waiting')) return node;
      this.#ready.pop();
    }
  }

  #nextDue() {
    for (;;) {
      const node = this.#delayed.peek();
      if (node === undefined) return undefined;
      if (isCurrent(node, 'waiting')) return node.availableAt;
      this.#delayed.pop();
    }
  }

  async enqueue(request) {
    if (!isJobRequest(request)) throw new TypeError('The memory queue takes a job request.');
    this.#sweep(this.#config.now());
    const held = this.jobs.get(request.id);
    if (held !== undefined) return { id: request.id, duplicate: true, existingHash: held.hash };
    if (this.#open >= this.#config.maxJobs) {
      throw new RangeError(`The memory queue holds ${this.#config.maxJobs} jobs.`);
    }
    const entry = {
      id: request.id,
      name: request.name,
      data: stored(request.data),
      hash: request.hash,
      priority: request.priority,
      rank: rankOf(request.priority),
      maxAttempts: request.maxAttempts,
      enqueuedAt: request.enqueuedAt,
      availableAt: request.availableAt ?? request.enqueuedAt ?? this.#config.now(),
      seq: this.#seq++,
      state: 'waiting',
      attempt: 0,
      redelivered: false,
      redeliveries: 0,
      token: undefined,
      leaseUntil: 0,
      version: 0,
    };
    this.jobs.set(entry.id, entry);
    this.#open += 1;
    this.#delayed.push(nodeOf(entry));
    this.#notify();
    return { id: request.id, duplicate: false };
  }

  async reserve(leaseMilliseconds) {
    const now = this.#config.now();
    this.#sweep(now);
    this.#expire(now);
    if (this.#pausedUntil > now) return { nextAvailableAt: this.#pausedUntil };
    this.#promote(now);
    const node = this.#nextReady();
    if (node === undefined) {
      const due = this.#nextDue();
      return due === undefined ? {} : { nextAvailableAt: due };
    }
    this.#ready.pop();
    const next = node.entry;
    next.state = 'active';
    next.attempt += 1;
    next.token = randomUUID();
    next.leaseUntil = now + leaseMilliseconds;
    next.version += 1;
    this.#active += 1;
    this.#leases.push(nodeOf(next));
    const job = {
      id: next.id,
      name: next.name,
      data: stored(next.data),
      attempt: next.attempt,
      maxAttempts: next.maxAttempts,
      enqueuedAt: next.enqueuedAt,
      redelivered: next.redelivered,
      redeliveries: next.redeliveries,
    };
    next.redelivered = false;
    this.#notify();
    return { lease: { job, token: next.token } };
  }

  async extend(lease, leaseMilliseconds) {
    const entry = this.#holds(lease);
    if (entry === undefined) return false;
    entry.leaseUntil = this.#config.now() + leaseMilliseconds;
    entry.version += 1;
    this.#leases.push(nodeOf(entry));
    return true;
  }

  async ack(lease, result) {
    const entry = this.#holds(lease);
    if (entry === undefined) return false;
    entry.result = result;
    if (this.#config.retainData !== 'all') entry.data = undefined;
    this.#finish(entry, 'completed');
    return true;
  }

  async retry(lease, availableAt, failure) {
    const entry = this.#holds(lease);
    if (entry === undefined) return false;
    this.#active -= 1;
    entry.availableAt = availableAt;
    entry.failure = failure;
    this.#wait(entry);
    this.#notify();
    return true;
  }

  async fail(lease, failure) {
    const entry = this.#holds(lease);
    if (entry === undefined) return false;
    entry.failure = failure;
    if (this.#config.retainData === 'none') entry.data = undefined;
    this.#finish(entry, 'failed');
    return true;
  }

  async release(lease, availableAt) {
    const entry = this.#holds(lease);
    if (entry === undefined) return false;
    this.#active -= 1;
    entry.attempt -= 1;
    entry.availableAt = availableAt ?? this.#config.now();
    this.#wait(entry);
    this.#notify();
    return true;
  }

  async pause(until) {
    this.#pausedUntil = Math.max(this.#pausedUntil, until);
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #busy(now) {
    if (this.#active > 0) return true;
    if (this.#pausedUntil > now) return false;
    this.#promote(now);
    return this.#nextReady() !== undefined;
  }

  // Settles when no job is ready now and none runs.
  async drain() {
    while (this.#busy(this.#config.now())) {
      await new Promise((resolve) => {
        const waiter = () => {
          this.#waiters.delete(waiter);
          resolve();
        };
        this.#waiters.add(waiter);
      });
    }
  }

  wake() {
    this.#notify();
  }
}

const viewOf = (entry, now) => {
  const view = {
    id: entry.id,
    name: entry.name,
    state: entry.state === 'waiting' && entry.availableAt > now ? 'delayed' : entry.state,
    priority: entry.priority,
    attempt: entry.attempt,
    maxAttempts: entry.maxAttempts,
    availableAt: entry.availableAt,
  };
  // Dropped once the job is done with, by `retainData`.
  if (entry.data !== undefined) view.data = stored(entry.data);
  if (entry.failure !== undefined) view.failure = entry.failure;
  if (entry.result !== undefined) view.result = entry.result;
  return view;
};

/**
 * Makes a queue in memory: a driver, and what it holds.
 *
 * @param options `now`, `sleep`, `leaseMilliseconds` (60000),
 * `pollIntervalMilliseconds` (1000), `maxJobs` (100000), `retainFinished`
 * (10000), `dedupeWindowSeconds` (a day), `retainFailedSeconds` (a week),
 * `retainData` ('failed'), `logger`.
 * @returns The driver, with `source`, `list()`, `get(id)`, `drain()` and
 * `wake()`.
 * @throws {TypeError} If an option is invalid.
 */
const createMemoryQueue = (options = {}) => {
  const config = {
    now: checkOptionalFunction(options.now, 'now') ?? Date.now,
    maxJobs: checkPositiveInteger(options.maxJobs ?? 100_000, 'maxJobs'),
    retainFinished: checkPositiveInteger(options.retainFinished ?? 10_000, 'retainFinished'),
    retainData: checkRetainData(options.retainData),
    ...retentionOf(options),
  };
  const source = new MemorySource(config);
  const driver = createPollingDriver(source, { ...options, now: config.now });
  return {
    ...driver,
    source,
    list() {
      source.prune();
      const views = [];
      const now = config.now();
      for (const entry of source.jobs.values()) views.push(viewOf(entry, now));
      return views;
    },
    get(id) {
      source.prune();
      const entry = source.jobs.get(id);
      return entry === undefined ? undefined : viewOf(entry, config.now());
    },
    drain: () => source.drain(),
    wake: () => source.wake(),
  };
};

module.exports = { createMemoryQueue };
