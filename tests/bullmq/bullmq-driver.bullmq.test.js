// Not ported: the BullMQ driver of ./bullmq and the mail queue of ./queue on
// BullMQ and a real Valkey (tests/bullmq/docker-compose.yml), skipped unless
// BULLMQ_REDIS_URL is set. Each test has a prefix of its own, removed after.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Queue, Worker } = require('bullmq');
const { createMemoryAuditSink } = require('../../src/audit/index.js');
const { createBullMQDriver } = require('../../src/bullmq/index.js');
const { createMailJobHandler, createMailQueue } = require('../../src/queue/index.js');
const { fakeTransport, sent } = require('../helpers/decorators/fake.js');

const url = process.env.BULLMQ_REDIS_URL;
const skip = url === undefined || url === '';

const connectionOf = () => {
  const parsed = new URL(url);
  return { host: parsed.hostname, port: Number(parsed.port || 6379), maxRetriesPerRequest: null };
};

const until = async (check, timeout = 10_000) => {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const job = (extra = {}) => ({
  kind: 'content',
  from: 'app@example.com',
  to: 'ada@example.com',
  subject: 'Hello',
  content: { text: 'Hi' },
  idempotencyKey: randomUUID(),
  ...extra,
});

// A driver, a queue and the cleanup of its keys.
const setup = (t, options = {}) => {
  const prefix = `mailer-test-${randomUUID()}`;
  const connection = connectionOf();
  const driver = createBullMQDriver({ bullmq: { Queue, Worker }, connection, prefix, ...options });
  const audit = createMemoryAuditSink();
  const queue = createMailQueue({ driver, audit });
  const consumers = [];
  t.after(async () => {
    for (const consumer of consumers) await consumer.close({ timeoutMilliseconds: 1000 });
    await driver.queue.obliterate({ force: true }).catch(() => {});
    await driver.close();
  });
  const worker = (workerOptions) => {
    const consumer = queue.createWorker(workerOptions);
    consumers.push(consumer);
    return consumer;
  };
  return { driver, queue, audit, worker, prefix };
};

test(
  'BullMQ (Valkey): a job is sent once, and an enqueue again is a duplicate',
  { skip },
  async (t) => {
    const { driver, queue, worker, audit } = setup(t);
    const transport = fakeTransport();
    const input = job();
    const first = await queue.enqueue(input);
    const again = await queue.enqueue(input);
    assert.equal(first.duplicate, false);
    assert.equal(again.duplicate, true);
    await assert.rejects(queue.enqueue({ ...input, to: 'other@example.com' }), {
      code: 'queue.key_reused',
    });
    worker({ transport });
    await until(async () => (await driver.queue.getJob(first.id))?.finishedOn);
    const held = await driver.queue.getJob(first.id);
    assert.equal(await held.getState(), 'completed');
    assert.deepEqual(held.returnvalue, { provider: 'fake', providerMessageId: 'm0' });
    assert.equal(transport.calls.length, 1);
    assert.equal(audit.stateOf(first.correlationId), 'accepted');
  },
);

test(
  'BullMQ (Valkey): a retry waits its delay and spends an attempt; a failure is final',
  { skip },
  async (t) => {
    const { driver, queue, worker } = setup(t);
    let calls = 0;
    const transport = fakeTransport(() => {
      calls++;
      if (calls === 1) {
        return {
          successful: false,
          errorMessages: ['busy'],
          errors: [
            {
              message: 'busy',
              code: 'http.503',
              category: 'service-unavailable',
              retryable: true,
              retryAfterMilliseconds: 400,
            },
          ],
          retryable: true,
        };
      }
      return sent('p2');
    });
    const started = Date.now();
    const { id } = await queue.enqueue(job());
    worker({ transport, random: () => 0 });
    await until(async () => (await driver.queue.getJob(id))?.finishedOn);
    const held = await driver.queue.getJob(id);
    assert.equal(await held.getState(), 'completed');
    assert.equal(held.attemptsMade, 2);
    assert.ok(held.finishedOn - started >= 400, 'not before Retry-After');
    // A refused message fails at once, its reason redacted.
    const refusing = fakeTransport(() => ({
      successful: false,
      errorMessages: ['550 no such user ada@example.com'],
      errors: [
        {
          message: '550 no such user ada@example.com',
          code: 'smtp.550',
          category: 'rejected',
          retryable: false,
        },
      ],
      retryable: false,
    }));
    const second = setup(t);
    const refused = await second.queue.enqueue(job());
    second.worker({ transport: refusing });
    await until(async () => (await second.driver.queue.getJob(refused.id))?.finishedOn);
    const failed = await second.driver.queue.getJob(refused.id);
    assert.equal(await failed.getState(), 'failed');
    assert.equal(failed.attemptsMade, 1);
    assert.doesNotMatch(failed.failedReason, /ada@example\.com/);
    assert.match(failed.failedReason, /^smtp\.550/);
  },
);

test(
  'BullMQ (Valkey): high priority runs before low, and a schedule is a delay',
  { skip },
  async (t) => {
    const { queue, worker } = setup(t);
    const order = [];
    const transport = fakeTransport((message) => {
      order.push(message.subject);
      return sent(message.subject);
    });
    await queue.enqueue(job({ subject: 'low-1', priority: 'low' }));
    await queue.enqueue(job({ subject: 'low-2', priority: 'low' }));
    await queue.enqueue(job({ subject: 'high', priority: 'high' }));
    await queue.enqueue(job({ subject: 'later', scheduledAt: new Date(Date.now() + 600) }));
    const started = Date.now();
    worker({ transport });
    await until(() => order.length === 4);
    assert.deepEqual(order.slice(0, 3), ['high', 'low-1', 'low-2']);
    assert.equal(order[3], 'later');
    assert.ok(Date.now() - started >= 500);
  },
);

test(
  'BullMQ (Valkey): a worker closed mid-job gives it back without spending an attempt',
  { skip },
  async (t) => {
    const { driver, queue, worker } = setup(t);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    // The renderer waits until the worker closes: the job is not yet sent.
    const renderer = { render: () => gate.then(() => Promise.reject(new Error('aborted'))) };
    const { id } = await queue.enqueue({
      ...job(),
      kind: 'template',
      template: 'x',
      content: undefined,
    });
    const consumer = worker({ transport: fakeTransport(), renderer });
    await until(async () => (await (await driver.queue.getJob(id))?.getState()) === 'active');
    const closing = consumer.close({ timeoutMilliseconds: 200 });
    setTimeout(release, 300);
    await closing;
    const held = await driver.queue.getJob(id);
    assert.equal(held.attemptsMade, 0);
    assert.ok(['waiting', 'prioritized', 'wait'].includes(await held.getState()));
  },
);

test(
  'BullMQ (Valkey): a Worker without the strategy of the driver fails loudly',
  { skip },
  async (t) => {
    const prefix = `mailer-test-${randomUUID()}`;
    const connection = connectionOf();
    const driver = createBullMQDriver({ bullmq: { Queue }, connection, prefix });
    const queue = createMailQueue({ driver });
    const transport = fakeTransport(() => ({
      successful: false,
      errorMessages: ['busy'],
      errors: [{ message: 'busy', code: 'x', category: 'server-error', retryable: true }],
      retryable: true,
    }));
    const { id } = await queue.enqueue(job());
    const errors = [];
    const processor = driver.createProcessor(createMailJobHandler({ transport }));
    const plain = new Worker(driver.queue.name, processor, { connection, prefix });
    plain.on('error', (error) => errors.push(error.message));
    t.after(async () => {
      await plain.close();
      await driver.queue.obliterate({ force: true }).catch(() => {});
      await driver.close();
    });
    await until(() => errors.length > 0);
    assert.match(errors[0], /Unknown backoff strategy alexify-mailer/);
    assert.ok(await driver.queue.getJob(id));
  },
);
