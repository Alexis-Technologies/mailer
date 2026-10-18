// Not ported: stand-ins for BullMQ's Queue and Worker, for the tests of
// ./bullmq: they record what the driver gives them; the Queue keeps a job
// under its id as BullMQ does, the first one when an id is added again.

const fakeBullMQ = () => {
  const queues = [];
  const workers = [];
  class Queue {
    constructor(name, opts) {
      this.name = name;
      this.opts = opts;
      this.jobs = new Map();
      this.added = [];
      this.limits = [];
      this.closed = 0;
      queues.push(this);
    }
    async add(name, data, opts) {
      this.added.push({ name, data, opts });
      if (!this.jobs.has(opts.jobId)) {
        this.jobs.set(opts.jobId, { data, timestamp: opts.timestamp, opts });
      }
      return { id: opts.jobId };
    }
    async addBulk(jobs) {
      const added = [];
      for (const job of jobs) added.push(await this.add(job.name, job.data, job.opts));
      return added;
    }
    async getJob(id) {
      return this.jobs.get(id) ?? null;
    }
    async rateLimit(milliseconds) {
      this.limits.push(milliseconds);
    }
    async close() {
      this.closed++;
    }
  }
  class Worker {
    constructor(name, processor, opts) {
      this.name = name;
      this.processor = processor;
      this.opts = opts;
      this.listeners = new Map();
      this.closed = 0;
      this.cancelled = [];
      this.closeWith = undefined;
      workers.push(this);
    }
    on(event, listener) {
      this.listeners.set(event, listener);
      return this;
    }
    emit(event, ...args) {
      this.listeners.get(event)?.(...args);
    }
    close() {
      this.closed++;
      return this.closeWith ?? Promise.resolve();
    }
    cancelAllJobs(reason) {
      this.cancelled.push(reason);
    }
  }
  return { Queue, Worker, queues, workers };
};

// A job as a BullMQ processor is given it.
const fakeJob = (extra = {}) => {
  const moves = [];
  return {
    id: 'j1',
    name: 'mail',
    data: { n: 1 },
    timestamp: 1000,
    opts: { attempts: 3 },
    attemptsMade: 0,
    stalledCounter: 0,
    moves,
    moveToDelayed: async (timestamp, token) => moves.push(['delayed', timestamp, token]),
    moveToWait: async (token) => moves.push(['wait', token]),
    async updateData(data) {
      moves.push(['data', data]);
      this.data = data;
    },
    ...extra,
  };
};

module.exports = { fakeBullMQ, fakeJob };
