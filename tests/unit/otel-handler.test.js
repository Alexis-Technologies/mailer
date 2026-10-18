// Not ported: tests of instrumentHandler of ./otel, the span and metrics of
// each run of a job, and of the trace context a mail queue gives its jobs.
const { test } = require('node:test');
const assert = require('node:assert');
const { instrumentHandler } = require('../../src/otel/index.js');
const { spanContextOf } = require('../../src/otel/handler.js');
const { createMailQueue, createMemoryQueue, parseMailJob } = require('../../src/queue/index.js');
const { MockMeterProvider } = require('../helpers/otel/mock-otel-providers.js');

const TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

// A tracer that keeps the options of each span it starts.
const recordingTracer = () => {
  const spans = [];
  return {
    spans,
    getTracer: () => ({
      startSpan(name, options) {
        const span = {
          name,
          options,
          attributes: {},
          ended: false,
          setAttributes(attributes) {
            Object.assign(span.attributes, attributes);
          },
          addEvent() {},
          setStatus(status) {
            span.status = status;
          },
          end() {
            span.ended = true;
          },
        };
        spans.push(span);
        return span;
      },
    }),
  };
};

const recordsOf = (meterProvider, name) => {
  for (const record of meterProvider.getAllRecords()) {
    if (record.name === name) return record.records;
  }
  return [];
};

const jobOf = (extra = {}) => ({
  id: 'job-1',
  name: 'mail',
  data: { v: 1, trace: TRACEPARENT },
  attempt: 1,
  maxAttempts: 5,
  enqueuedAt: 1000,
  redelivered: false,
  ...extra,
});

test('OTel handler: a run is a span linked to its producer, and counted by outcome', async () => {
  const tracerProvider = recordingTracer();
  const meterProvider = new MockMeterProvider();
  let clock = 5000;
  const handler = instrumentHandler(
    async () => {
      clock += 250;
      return { type: 'ack', result: { provider: 'p' } };
    },
    { tracerProvider, meterProvider, now: () => clock },
  );
  const outcome = await handler(jobOf(), new AbortController().signal);
  assert.deepStrictEqual(outcome, { type: 'ack', result: { provider: 'p' } });
  const [span] = tracerProvider.spans;
  assert.strictEqual(span.name, 'mailer.queue.process');
  assert.strictEqual(span.options.kind, 4);
  assert.deepStrictEqual(span.options.links, [
    {
      context: {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
        isRemote: true,
      },
    },
  ]);
  assert.strictEqual(span.attributes['mailer.job.outcome'], 'ack');
  assert.deepStrictEqual(span.status, { code: 1 });
  assert.ok(span.ended);
  assert.deepStrictEqual(recordsOf(meterProvider, 'mailer.queue.jobs'), [
    { value: 1, attributes: { outcome: 'ack' } },
  ]);
  assert.deepStrictEqual(recordsOf(meterProvider, 'mailer.queue.lag'), [
    { value: 4000, attributes: undefined },
  ]);
  assert.deepStrictEqual(recordsOf(meterProvider, 'mailer.queue.job.duration'), [
    { value: 250, attributes: { outcome: 'ack' } },
  ]);
});

test('OTel handler: a failure, a run again and a throw are told', async () => {
  const tracerProvider = recordingTracer();
  const meterProvider = new MockMeterProvider();
  const failing = instrumentHandler(
    async () => ({ type: 'fail', code: 'x.rejected', reason: 'no' }),
    { tracerProvider, meterProvider },
  );
  await failing(jobOf({ redelivered: true, data: { v: 1 } }), new AbortController().signal);
  const [span] = tracerProvider.spans;
  assert.deepStrictEqual(span.status, { code: 2, message: 'x.rejected' });
  assert.deepStrictEqual(span.options.links, []);
  assert.strictEqual(recordsOf(meterProvider, 'mailer.queue.redeliveries').length, 1);
  assert.deepStrictEqual(recordsOf(meterProvider, 'mailer.queue.jobs')[0].attributes, {
    outcome: 'fail',
    code: 'x.rejected',
  });
  const throwing = instrumentHandler(
    async () => {
      throw new Error('bug');
    },
    { tracerProvider, meterProvider },
  );
  await assert.rejects(throwing(jobOf(), new AbortController().signal), /bug/);
  assert.strictEqual(tracerProvider.spans[1].status.code, 2);
  assert.ok(tracerProvider.spans[1].ended);
});

test('OTel handler: withSpan runs the handler with its span; each side can be off', async () => {
  const tracerProvider = recordingTracer();
  const seen = [];
  const handler = instrumentHandler(async () => ({ type: 'ack' }), {
    tracerProvider,
    metrics: false,
    withSpan: (span, run) => {
      seen.push(span.name);
      return run();
    },
  });
  await handler(jobOf(), new AbortController().signal);
  assert.deepStrictEqual(seen, ['mailer.queue.process']);
  const bare = instrumentHandler(async () => ({ type: 'release' }), {
    tracing: false,
    metrics: false,
  });
  assert.deepStrictEqual(await bare(jobOf(), new AbortController().signal), { type: 'release' });
  assert.throws(() => instrumentHandler(), /needs a handler/);
  assert.throws(() => instrumentHandler(async () => {}), /tracerProvider/);
  assert.throws(() => instrumentHandler(async () => {}, { tracing: false }), /meterProvider/);
  assert.throws(
    () => instrumentHandler(async () => {}, { tracing: false, metrics: false, withSpan: 1 }),
    /withSpan/,
  );
});

test('OTel handler: only a valid traceparent is a link', () => {
  assert.strictEqual(spanContextOf(undefined), undefined);
  assert.strictEqual(spanContextOf('nope'), undefined);
  assert.strictEqual(spanContextOf(TRACEPARENT.replace(/^00/, 'ff')), undefined);
  assert.strictEqual(spanContextOf(`00-${'0'.repeat(32)}-b7ad6b7169203331-01`), undefined);
  assert.strictEqual(
    spanContextOf(`00-0af7651916cd43dd8448eb211c80319c-${'0'.repeat(16)}-01`),
    undefined,
  );
  assert.strictEqual(spanContextOf(TRACEPARENT).traceFlags, 1);
});

test('OTel handler: a mail queue gives each job the producer’s trace, outside its hash and signature', async () => {
  let current = TRACEPARENT;
  const key = { id: 'k', secret: 'k'.repeat(32) };
  const queue = createMailQueue({
    driver: createMemoryQueue(),
    signingKeys: [key],
    traceContext: () => current,
  });
  const input = {
    kind: 'content',
    subject: 's',
    content: { text: 't' },
    from: 'app@example.com',
    to: 'ada@example.com',
  };
  await queue.enqueue({ ...input, idempotencyKey: 'a' });
  current = 'not a traceparent';
  await queue.enqueue({ ...input, idempotencyKey: 'b' });
  const [traced, untraced] = queue.driver.list();
  assert.strictEqual(traced.data.trace, TRACEPARENT);
  assert.strictEqual(untraced.data.trace, undefined);
  assert.strictEqual(parseMailJob(traced.data, { signingKeys: [key] }).trace, TRACEPARENT);
  assert.throws(
    () => createMailQueue({ driver: createMemoryQueue(), traceContext: 1 }),
    /traceContext/,
  );
});
