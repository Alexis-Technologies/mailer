// Not ported: tests of the mail queue of ./queue end to end, on the memory
// queue, with templates, the audit and the decorators it is meant to go with.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMemoryAuditSink, stateOf } = require('../../src/audit/index.js');
const {
  IdempotencyTransport,
  createMemoryIdempotencyStore,
} = require('../../src/idempotency/index.js');
const { MailQueueError, createMailQueue, createMemoryQueue } = require('../../src/queue/index.js');
const { createMemoryLoader, createTemplateRenderer } = require('../../src/templates/index.js');
const { fakeEngine } = require('../helpers/templates/fake-engine.js');
const { fakeTransport, sent } = require('../helpers/decorators/fake.js');
const { manualClock } = require('../helpers/queue/clock.js');

const templates = createTemplateRenderer({
  engine: fakeEngine(),
  loader: createMemoryLoader({
    'reset.tpl': '---\nsubject: Reset your password\n---\n<p>Open {{url}}</p>',
  }),
});

const resetJob = (extra = {}) => ({
  kind: 'template',
  template: 'reset',
  context: { url: 'https://example.com/r/1' },
  from: 'Hirevel <no-reply@example.com>',
  to: 'ada@example.com',
  idempotencyKey: 'reset:1',
  ...extra,
});

const setup = (options = {}) => {
  const clock = manualClock(Date.parse('2026-10-18T09:00:00Z'));
  const driver = createMemoryQueue({
    now: clock.now,
    sleep: clock.sleep,
    pollIntervalMilliseconds: 1000,
  });
  const audit = createMemoryAuditSink();
  const queue = createMailQueue({ driver, audit, now: clock.now, ...options });
  return { clock, driver, audit, queue };
};

test('Queue: a message enqueued is rendered and sent by a worker, its states told', async () => {
  const { driver, audit, queue } = setup();
  const transport = fakeTransport((message) => sent(`p-${message.subject.length}`));
  const enqueued = await queue.enqueue(resetJob());
  assert.strictEqual(enqueued.duplicate, false);
  assert.match(enqueued.messageId, /@example\.com$/);
  await using worker = queue.createWorker({ transport, renderer: templates, random: () => 0 });
  await driver.drain();
  assert.strictEqual(transport.calls.length, 1);
  const { message } = transport.calls[0];
  assert.strictEqual(message.subject, 'Reset your password');
  assert.deepStrictEqual(message.content, {
    html: '<p>Open https://example.com/r/1</p>',
    text: 'Open https://example.com/r/1',
  });
  assert.strictEqual(message.messageId, enqueued.messageId);
  assert.deepStrictEqual(
    audit
      .eventsOf(enqueued.correlationId)
      .map((event) => [event.state, event.source, event.attempt]),
    [
      ['queued', 'producer', 0],
      ['rendered', 'worker', 1],
      ['submitted', 'worker', 1],
      ['accepted', 'worker', 1],
    ],
  );
  assert.strictEqual(audit.stateOf(enqueued.correlationId), 'accepted');
  assert.strictEqual(driver.get(enqueued.id).state, 'completed');
  assert.ok(worker);
});

test('Queue: the same message enqueued twice is sent once, another under its key refused', async () => {
  const { driver, audit, queue } = setup();
  const first = await queue.enqueue(resetJob());
  const again = await queue.enqueue(resetJob());
  assert.deepStrictEqual([again.id, again.duplicate], [first.id, true]);
  await assert.rejects(
    queue.enqueue(resetJob({ to: 'mallory@example.com' })),
    (error) => error instanceof MailQueueError && error.code === 'queue.key_reused',
  );
  assert.strictEqual(audit.events.length, 1, 'a duplicate is not queued again');
  assert.strictEqual(driver.list().length, 1);
  // A driver that cannot tell a duplicate says so as undefined.
  const blind = {
    id: 'blind',
    enqueue: async (request) => ({ id: request.id, duplicate: undefined }),
    consume: () => ({ close: async () => {} }),
  };
  const unknown = await createMailQueue({ driver: blind }).enqueue(resetJob());
  assert.strictEqual(unknown.duplicate, undefined);
  const lenient = await createMailQueue({
    driver: { ...blind, enqueue: async (r) => ({ id: r.id, duplicate: true }) },
  }).enqueue(resetJob());
  assert.strictEqual(lenient.duplicate, true);
});

test('Queue: a failure the provider asks to wait for is retried after Retry-After', async () => {
  const { clock, driver, audit, queue } = setup();
  const answers = [
    {
      successful: false,
      errorMessages: ['429'],
      errors: [
        {
          message: '429',
          code: 'http.429',
          category: 'rate-limit',
          retryable: true,
          retryAfterMilliseconds: 60_000,
        },
      ],
      retryable: true,
    },
    sent('p-2'),
  ];
  let index = 0;
  const transport = fakeTransport(() => answers[index++]);
  const { correlationId, id } = await queue.enqueue(resetJob());
  const worker = queue.createWorker({ transport, renderer: templates, random: () => 0 });
  await driver.drain();
  assert.strictEqual(transport.calls.length, 1);
  assert.strictEqual(driver.get(id).state, 'delayed');
  clock.advance(59_999);
  driver.wake();
  await driver.drain();
  assert.strictEqual(transport.calls.length, 1, 'not before Retry-After');
  clock.advance(1);
  driver.wake();
  await driver.drain();
  await worker.close();
  assert.strictEqual(transport.calls.length, 2);
  assert.strictEqual(transport.calls[1].message.messageId, transport.calls[0].message.messageId);
  assert.deepStrictEqual(
    audit.eventsOf(correlationId).map((event) => `${event.state}#${event.attempt}`),
    [
      'queued#0',
      'rendered#1',
      'submitted#1',
      'queued#2',
      'rendered#2',
      'submitted#2',
      'accepted#2',
    ],
  );
  assert.strictEqual(stateOf(audit.eventsOf(correlationId)), 'accepted');
});

test('Queue: a crash during a send is not sent again blindly behind IdempotencyTransport', async () => {
  // A worker took the job and died mid-send: the job comes back, and the
  // shared store still holds its key, so the retry is of unknown delivery,
  // reconciled from the provider's events, not sent twice.
  const store = createMemoryIdempotencyStore();
  const { clock, driver, audit, queue } = setup();
  const { correlationId, id } = await queue.enqueue(resetJob());
  const hang = fakeTransport(() => new Promise(() => {}));
  const crashed = queue.createWorker({
    transport: new IdempotencyTransport(hang, { store }),
    renderer: templates,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(hang.calls.length, 1);
  // The worker is gone without settling; its lease runs out.
  clock.advance(61_000);
  const inner = fakeTransport();
  const worker = createMailQueue({ driver, audit, now: clock.now }).createWorker({
    transport: new IdempotencyTransport(inner, { store }),
    renderer: templates,
  });
  driver.wake();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await worker.close({ timeoutMilliseconds: 10 });
  await crashed.close({ timeoutMilliseconds: 10 });
  assert.strictEqual(inner.calls.length, 0, 'not sent again');
  assert.strictEqual(driver.get(id).state, 'failed');
  assert.strictEqual(stateOf(audit.eventsOf(correlationId)), 'delivery_unknown');
  assert.ok(audit.eventsOf(correlationId).some((event) => event.redelivered === true));
});

test('Queue: enqueueMany goes through the driver’s batch, or one by one', async () => {
  const { driver, queue } = setup();
  const results = await queue.enqueueMany([
    resetJob({ idempotencyKey: 'a' }),
    resetJob({ idempotencyKey: 'b' }),
  ]);
  assert.deepStrictEqual(
    results.map((result) => result.duplicate),
    [false, false],
  );
  assert.strictEqual(driver.list().length, 2);
  const batches = [];
  const batching = {
    id: 'batching',
    enqueue: async () => assert.fail('one by one'),
    enqueueMany: async (requests) => {
      batches.push(requests.length);
      return requests.map((request) => ({ id: request.id, duplicate: false }));
    },
    consume: () => ({ close: async () => {} }),
  };
  await createMailQueue({ driver: batching }).enqueueMany([
    resetJob({ idempotencyKey: 'c' }),
    resetJob({ idempotencyKey: 'd' }),
  ]);
  assert.deepStrictEqual(batches, [2]);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(queue.enqueueMany([], { signal: aborted.signal }), { name: 'AbortError' });
  await assert.rejects(queue.enqueue(resetJob(), { signal: aborted.signal }), {
    name: 'AbortError',
  });
});

test('Queue: the queued event goes in the transaction of the enqueue; a strict sink fails it', async (t) => {
  const contexts = [];
  const sink = { append: (event, context) => contexts.push([event.state, context?.transaction]) };
  const transactional = {
    id: 'outbox',
    transactional: true,
    enqueue: async (request, options) => ({
      id: request.id,
      duplicate: false,
      seen: options.transaction,
    }),
    consume: () => ({ close: async () => {} }),
  };
  const queue = createMailQueue({ driver: transactional, audit: sink });
  await queue.enqueue(resetJob(), { transaction: 'session-1' });
  assert.deepStrictEqual(contexts, [['queued', 'session-1']]);
  const broken = { append: () => Promise.reject(new Error('audit down')) };
  await assert.rejects(
    createMailQueue({ driver: transactional, audit: broken, auditStrict: true }).enqueue(
      resetJob(),
    ),
    /audit down/,
  );
  const warnings = [];
  const listener = (warning) => warnings.push(warning.code);
  process.on('warning', listener);
  t.after(() => process.off('warning', listener));
  await createMailQueue({ driver: transactional, audit: broken }).enqueue(resetJob());
  await new Promise(setImmediate);
  assert.ok(warnings.includes('MAILER_AUDIT_FAILED'));
});

test('Queue: the queue logs its enqueues; it checks its options', async () => {
  const records = [];
  const logger = {
    debug: (record, message) => records.push([message, record.jobId !== undefined]),
  };
  const { queue } = setup({ logger });
  await queue.enqueue(resetJob());
  await queue.enqueue(resetJob());
  assert.deepStrictEqual(records, [
    ['queue.enqueued', true],
    ['queue.duplicate', true],
  ]);
  assert.throws(() => createMailQueue(), /needs a driver/);
  assert.throws(() => createMailQueue({ driver: {} }), /needs a driver/);
  const driver = createMemoryQueue();
  assert.throws(() => createMailQueue({ driver, audit: {} }), /must have append/);
  assert.throws(() => createMailQueue({ driver, auditStrict: 1 }), /auditStrict/);
  // The options of its jobs reach them.
  const scoped = createMailQueue({ driver, namespace: 'tenant-mail', maxAttempts: 2 });
  const { id } = await scoped.enqueue(resetJob());
  assert.strictEqual(driver.get(id).maxAttempts, 2);
});

test('Queue: enqueueMany refuses a key used before only once every other job is told', async () => {
  const { driver, audit, queue } = setup();
  await queue.enqueue(resetJob({ idempotencyKey: 'taken' }));
  const batch = [
    resetJob({ idempotencyKey: 'first' }),
    resetJob({ idempotencyKey: 'taken', context: { url: 'https://example.com/other' } }),
    resetJob({ idempotencyKey: 'last' }),
  ];
  const error = await queue.enqueueMany(batch).catch((thrown) => thrown);
  assert.ok(error instanceof MailQueueError);
  assert.strictEqual(error.code, 'queue.key_reused');
  assert.strictEqual(error.jobIds.length, 1);
  assert.deepStrictEqual(
    error.answers.map((answer) => answer.duplicate),
    [false, false],
  );
  // The jobs after the refused one were enqueued, and told to the sink.
  for (const answer of error.answers) {
    assert.strictEqual(driver.get(answer.id).state, 'waiting');
    assert.strictEqual(audit.stateOf(answer.correlationId), 'queued');
  }
});

test('Queue: without a transaction, a strict sink that fails refuses the enqueue before the job', async () => {
  const broken = { append: () => Promise.reject(new Error('audit down')) };
  const { driver, queue } = setup({ audit: broken, auditStrict: true });
  await assert.rejects(queue.enqueue(resetJob()), /audit down/);
  await assert.rejects(queue.enqueueMany([resetJob({ idempotencyKey: 'b' })]), /audit down/);
  // Nothing was enqueued: a retry of the caller is not a second message.
  assert.strictEqual(driver.list().length, 0);
  // A driver that writes no transaction refuses one rather than ignore it.
  await assert.rejects(queue.enqueue(resetJob(), { transaction: {} }), {
    name: 'TypeError',
    message: /memory driver writes no transaction/,
  });
  await assert.rejects(queue.enqueueMany([resetJob()], { transaction: {} }), TypeError);
  // The event of a first enqueue is written before it, a duplicate's once.
  const order = [];
  const sink = createMemoryAuditSink();
  const recording = {
    append: (event) => {
      order.push(`audit:${event.state}`);
      return sink.append(event);
    },
  };
  const tracked = setup({ audit: recording });
  const enqueue = tracked.driver.enqueue;
  tracked.driver.enqueue = (request, options) => {
    order.push('enqueue');
    return enqueue(request, options);
  };
  const first = await tracked.queue.enqueue(resetJob());
  await tracked.queue.enqueue(resetJob());
  assert.deepStrictEqual(order, ['audit:queued', 'enqueue', 'audit:queued', 'enqueue']);
  assert.strictEqual(sink.eventsOf(first.correlationId).length, 1);
});
