// Not ported: a queue in memory, for tests and a single process: the source
// the polling driver reads, with the semantics a store's outbox has: jobs by
// priority, then time, then order; a lease per run, its attempt counted; a job
// whose lease ran out comes back as redelivered; an id is a duplicate while
// its job is kept.

const { randomUUID } = require('node:crypto');
const { createPollingDriver } = require('../internal/polling-driver.js');
const { checkOptionalFunction, checkPositiveInteger } = require('../internal/options.js');

const RANK = new Map([
  ['high', 0],
  ['normal', 1],
  ['low', 2],
]);

const isRequest = (request) =>
  typeof request?.id === 'string' &&
  request.id !== '' &&
  typeof request.name === 'string' &&
  typeof request.data === 'object' &&
  request.data !== null &&
  RANK.has(request.priority) &&
  Number.isInteger(request.maxAttempts) &&
  request.maxAttempts >= 1;

// The data of a job as a store gives it back: a copy, never the object
// enqueued.
const stored = (data) => JSON.parse(JSON.stringify(data));

// Whether `a` runs before `b`.
const before = (a, b) => {
  const rank = RANK.get(a.priority) - RANK.get(b.priority);
  if (rank !== 0) return rank < 0;
  if (a.availableAt !== b.availableAt) return a.availableAt < b.availableAt;
  return a.seq < b.seq;
};

class MemorySource {
  id = 'memory';
  jobs = new Map();
  // The jobs not finished, the ones reserve() looks through.
  #open = new Map();
  #finished = [];
  #listeners = new Set();
  #waiters = new Set();
  #seq = 0;
  #pausedUntil = 0;
  #config;

  constructor(config) {
    this.#config = config;
  }

  #notify() {
    for (const listener of this.#listeners) listener();
    for (const waiter of this.#waiters) waiter();
  }

  #finish(entry, state) {
    entry.state = state;
    entry.token = undefined;
    this.#open.delete(entry.id);
    this.#finished.push(entry.id);
    while (this.#finished.length > this.#config.retainFinished) {
      this.jobs.delete(this.#finished.shift());
    }
    this.#notify();
  }

  #holds(lease) {
    const entry = this.jobs.get(lease?.job?.id);
    const held = entry !== undefined && entry.state === 'active' && entry.token === lease.token;
    return held ? entry : undefined;
  }

  // A job whose lease ran out comes back, its attempt run again.
  #expire(now) {
    for (const entry of this.#open.values()) {
      if (entry.state === 'active' && entry.leaseUntil <= now) {
        entry.state = 'waiting';
        entry.token = undefined;
        entry.attempt -= 1;
        entry.redelivered = true;
      }
    }
  }

  async enqueue(request) {
    if (!isRequest(request)) throw new TypeError('The memory queue takes a job request.');
    const held = this.jobs.get(request.id);
    if (held !== undefined) return { id: request.id, duplicate: true, existingHash: held.hash };
    if (this.#open.size >= this.#config.maxJobs) {
      throw new RangeError(`The memory queue holds ${this.#config.maxJobs} jobs.`);
    }
    const entry = {
      id: request.id,
      name: request.name,
      data: stored(request.data),
      hash: request.hash,
      priority: request.priority,
      maxAttempts: request.maxAttempts,
      enqueuedAt: request.enqueuedAt,
      availableAt: request.availableAt ?? request.enqueuedAt ?? this.#config.now(),
      seq: this.#seq++,
      state: 'waiting',
      attempt: 0,
      redelivered: false,
      token: undefined,
      leaseUntil: 0,
    };
    this.jobs.set(entry.id, entry);
    this.#open.set(entry.id, entry);
    this.#notify();
    return { id: request.id, duplicate: false };
  }

  // The next job ready now, and when the next one is due.
  #next(now) {
    let next;
    let nextAvailableAt;
    for (const entry of this.#open.values()) {
      if (entry.state === 'active') continue;
      if (entry.availableAt > now) {
        if (nextAvailableAt === undefined || entry.availableAt < nextAvailableAt) {
          nextAvailableAt = entry.availableAt;
        }
      } else if (next === undefined || before(entry, next)) {
        next = entry;
      }
    }
    return { next, nextAvailableAt };
  }

  async reserve(leaseMilliseconds) {
    const now = this.#config.now();
    this.#expire(now);
    if (this.#pausedUntil > now) return { nextAvailableAt: this.#pausedUntil };
    const { next, nextAvailableAt } = this.#next(now);
    if (next === undefined) return nextAvailableAt === undefined ? {} : { nextAvailableAt };
    next.state = 'active';
    next.attempt += 1;
    next.token = randomUUID();
    next.leaseUntil = now + leaseMilliseconds;
    const job = {
      id: next.id,
      name: next.name,
      data: stored(next.data),
      attempt: next.attempt,
      maxAttempts: next.maxAttempts,
      enqueuedAt: next.enqueuedAt,
      redelivered: next.redelivered,
    };
    next.redelivered = false;
    this.#notify();
    return { lease: { job, token: next.token } };
  }

  async extend(lease, leaseMilliseconds) {
    const entry = this.#holds(lease);
    if (entry === undefined) return false;
    entry.leaseUntil = this.#config.now() + leaseMilliseconds;
    return true;
  }

  async ack(lease, result) {
    const entry = this.#holds(lease);
    if (entry === undefined) return;
    entry.result = result;
    this.#finish(entry, 'completed');
  }

  async retry(lease, availableAt, failure) {
    const entry = this.#holds(lease);
    if (entry === undefined) return;
    entry.state = 'waiting';
    entry.token = undefined;
    entry.availableAt = availableAt;
    entry.failure = failure;
    this.#notify();
  }

  async fail(lease, failure) {
    const entry = this.#holds(lease);
    if (entry === undefined) return;
    entry.failure = failure;
    this.#finish(entry, 'failed');
  }

  async release(lease, availableAt) {
    const entry = this.#holds(lease);
    if (entry === undefined) return;
    entry.state = 'waiting';
    entry.token = undefined;
    entry.attempt -= 1;
    entry.availableAt = availableAt ?? this.#config.now();
    this.#notify();
  }

  async pause(until) {
    this.#pausedUntil = Math.max(this.#pausedUntil, until);
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #busy(now) {
    for (const entry of this.#open.values()) {
      if (entry.state === 'active' || (entry.availableAt <= now && this.#pausedUntil <= now)) {
        return true;
      }
    }
    return false;
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
    data: stored(entry.data),
  };
  if (entry.failure !== undefined) view.failure = entry.failure;
  if (entry.result !== undefined) view.result = entry.result;
  return view;
};

/**
 * Makes a queue in memory: a driver, and what it holds.
 *
 * @param options `now`, `sleep`, `leaseMilliseconds` (60000),
 * `pollIntervalMilliseconds` (1000), `maxJobs` (100000), `retainFinished`
 * (10000), `logger`.
 * @returns The driver, with `list()`, `get(id)`, `drain()` and `wake()`.
 * @throws {TypeError} If an option is invalid.
 */
const createMemoryQueue = (options = {}) => {
  const config = {
    now: checkOptionalFunction(options.now, 'now') ?? Date.now,
    maxJobs: checkPositiveInteger(options.maxJobs ?? 100_000, 'maxJobs'),
    retainFinished: checkPositiveInteger(options.retainFinished ?? 10_000, 'retainFinished'),
  };
  const source = new MemorySource(config);
  const driver = createPollingDriver(source, { ...options, now: config.now });
  return {
    ...driver,
    list() {
      const views = [];
      const now = config.now();
      for (const entry of source.jobs.values()) views.push(viewOf(entry, now));
      return views;
    },
    get(id) {
      const entry = source.jobs.get(id);
      return entry === undefined ? undefined : viewOf(entry, config.now());
    },
    drain: () => source.drain(),
    wake: () => source.wake(),
  };
};

module.exports = { createMemoryQueue };
