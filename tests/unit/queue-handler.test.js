// Not ported: tests of the handler of mail jobs of ./queue, one per case of
// what the queue does with an attempt.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMemoryAuditSink } = require('../../src/audit/index.js');
const { createMailJobHandler, prepareMailJob } = require('../../src/queue/index.js');
const { hashJson } = require('../../src/queue/hash.js');
const { markDeliveryUnknown } = require('../../src/internal/delivery-unknown.js');
const {
  TemplateNotFoundError,
  createMemoryLoader,
  createTemplateRenderer,
} = require('../../src/templates/index.js');
const { fakeEngine } = require('../helpers/templates/fake-engine.js');
const { fakeTransport, sent } = require('../helpers/decorators/fake.js');

const NOW = Date.parse('2026-10-18T09:00:00Z');
const templates = createTemplateRenderer({
  engine: fakeEngine(),
  loader: createMemoryLoader({
    'welcome.tpl': '---\nsubject: Welcome, {{name}}\n---\n<p>Hi {{name}}</p>',
    'bare.tpl': '<p>no subject</p>',
  }),
});

const jobOf = (input = {}, run = {}) => {
  const { data, request } = prepareMailJob(
    {
      kind: 'template',
      template: 'welcome',
      context: { name: 'Ada' },
      from: 'app@example.com',
      to: 'ada@example.com',
      idempotencyKey: 'welcome:1',
      ...input,
    },
    { now: () => NOW },
  );
  return {
    id: request.id,
    name: request.name,
    data: JSON.parse(JSON.stringify(data)),
    attempt: 1,
    maxAttempts: request.maxAttempts,
    enqueuedAt: request.enqueuedAt,
    redelivered: false,
    ...run,
  };
};

const failure = (category, extra = {}) => ({
  successful: false,
  errorMessages: [`${category} for ada@example.com`],
  errors: [
    {
      message: `${category} for ada@example.com`,
      code: extra.code ?? `x.${category}`,
      category,
      retryable: extra.retryable ?? false,
      retryAfterMilliseconds: extra.retryAfterMilliseconds,
    },
  ],
  retryable: extra.retryable ?? false,
  deliveryUnknown: extra.deliveryUnknown,
  provider: 'fake',
});

const handlerOf = (options = {}) => {
  const audit = createMemoryAuditSink();
  const transport = options.transport ?? fakeTransport();
  const handler = createMailJobHandler({
    transport,
    renderer: templates,
    audit,
    random: () => 0,
    now: () => NOW,
    ...options,
  });
  return { handler, audit, transport };
};

const run = (handler, job, signal = new AbortController().signal) => handler(job, signal);
const states = (audit) => audit.events.map((event) => `${event.state}#${event.attempt}`);

test('Queue: a job is rendered, sent and acknowledged, each state told', async () => {
  const { handler, audit, transport } = handlerOf();
  const job = jobOf({
    tags: ['onboarding'],
    tenantId: 'acme',
    attachments: [{ filename: 'a.txt', content: new TextEncoder().encode('hi') }],
    scheduledAt: new Date(NOW - 1000),
  });
  const outcome = await run(handler, job);
  assert.deepStrictEqual(outcome, {
    type: 'ack',
    result: { provider: 'fake', providerMessageId: 'm0' },
  });
  const [{ message }] = transport.calls;
  assert.strictEqual(message.subject, 'Welcome, Ada');
  assert.deepStrictEqual(message.content, { html: '<p>Hi Ada</p>', text: 'Hi Ada' });
  assert.strictEqual(message.idempotencyKey, job.id);
  assert.strictEqual(message.messageId, job.data.messageId);
  assert.strictEqual(message.metadata.correlationId, job.data.correlationId);
  assert.strictEqual(
    message.scheduledAt,
    undefined,
    'a schedule is the queue’s, not the provider’s',
  );
  assert.deepStrictEqual(new TextDecoder().decode(message.attachments[0].content), 'hi');
  assert.deepStrictEqual(states(audit), ['rendered#1', 'submitted#1', 'accepted#1']);
  const accepted = audit.events[2];
  assert.deepStrictEqual(
    [
      accepted.jobId,
      accepted.tenantId,
      accepted.template,
      accepted.tags,
      accepted.providerMessageId,
    ],
    [job.id, 'acme', 'welcome', ['onboarding'], 'm0'],
  );
  assert.match(audit.events[0].messageHash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(audit.events), /ada@example\.com/);
  // A run again of the attempt writes the same events, which a sink keeps once.
  await run(handler, job);
  assert.strictEqual(audit.events.length, 3);
});

test('Queue: a content job is sent as it is; the subject of the job wins over the template', async () => {
  const { handler, transport } = handlerOf();
  const content = jobOf({ kind: 'content', subject: 'Plain', content: { text: 'just text' } });
  assert.strictEqual((await run(handler, content)).type, 'ack');
  assert.deepStrictEqual(transport.calls[0].message.content, { text: 'just text' });
  await run(handler, jobOf({ subject: 'Mine', idempotencyKey: 'k2' }));
  assert.strictEqual(transport.calls[1].message.subject, 'Mine');
  // The renderer is given the locale and the tenant.
  const inputs = [];
  const spy = {
    render: (input) => {
      inputs.push(input);
      return { html: '<p/>', subject: 's' };
    },
  };
  const { handler: spied } = handlerOf({ renderer: spy });
  await run(spied, jobOf({ locale: 'uk', tenantId: 't1' }));
  assert.deepStrictEqual(inputs, [
    {
      template: 'welcome',
      context: { name: 'Ada' },
      locale: 'uk',
      tenantId: 't1',
      signal: inputs[0].signal,
    },
  ]);
  assert.ok(inputs[0].signal instanceof AbortSignal);
});

test('Queue: a retryable failure is retried after at least its Retry-After', async () => {
  const transport = fakeTransport(() =>
    failure('rate-limit', { retryable: true, retryAfterMilliseconds: 120_000 }),
  );
  const { handler, audit } = handlerOf({ transport });
  const job = jobOf();
  const outcome = await run(handler, job);
  assert.deepStrictEqual(outcome, {
    type: 'retry',
    delayMilliseconds: 120_000,
    code: 'x.rate-limit',
    reason: 'rate-limit for [REDACTED]',
    scope: 'job',
  });
  assert.deepStrictEqual(states(audit), ['rendered#1', 'submitted#1', 'queued#2']);
  assert.strictEqual(audit.events[2].retryAt, new Date(NOW + 120_000).toISOString());
  assert.strictEqual(audit.events[2].error.category, 'rate-limit');
  // With a backoff longer than Retry-After, the backoff; with random 1, a
  // little jitter over Retry-After.
  const { handler: jittered } = handlerOf({ transport, random: () => 0.999 });
  const late = await run(jittered, jobOf({ idempotencyKey: 'j' }));
  assert.ok(late.delayMilliseconds >= 120_000 && late.delayMilliseconds < 120_000 + 12_000);
  // A rate limit can make the whole queue wait.
  const { handler: queueWide } = handlerOf({ transport, rateLimitScope: 'queue' });
  assert.strictEqual((await run(queueWide, jobOf({ idempotencyKey: 'q' }))).scope, 'queue');
  // A retryable failure without Retry-After waits the backoff.
  const busy = fakeTransport(() => failure('server-error', { retryable: true }));
  const { handler: backoff } = handlerOf({
    transport: busy,
    random: () => 0.5,
    backoff: { baseDelayMilliseconds: 1000, factor: 2, maxDelayMilliseconds: 10_000 },
  });
  assert.strictEqual((await run(backoff, jobOf({}, { attempt: 3 }))).delayMilliseconds, 2000);
});

test('Queue: a retryable failure on the last attempt fails the job', async () => {
  const transport = fakeTransport(() => failure('server-error', { retryable: true }));
  const { handler, audit } = handlerOf({ transport });
  const outcome = await run(handler, jobOf({}, { attempt: 5, maxAttempts: 5 }));
  assert.strictEqual(outcome.type, 'fail');
  assert.strictEqual(outcome.code, 'queue.attempts_exhausted');
  assert.match(outcome.reason, /^x\.server-error: /);
  assert.deepStrictEqual(states(audit).at(-1), 'failed#5');
});

test('Queue: a permanent failure is not retried, a delivery of unknown outcome neither', async () => {
  // Before, in a queue that retries everything: a refused message went three times.
  for (const category of ['validation', 'rejected', 'unsupported']) {
    const { handler } = handlerOf({ transport: fakeTransport(() => failure(category)) });
    const outcome = await run(handler, jobOf());
    assert.deepStrictEqual([outcome.type, outcome.code], ['fail', `x.${category}`], category);
  }
  const unknown = fakeTransport(() =>
    failure('timeout', { retryable: true, deliveryUnknown: true }),
  );
  const { handler, audit } = handlerOf({ transport: unknown });
  const outcome = await run(handler, jobOf());
  assert.strictEqual(outcome.type, 'fail');
  assert.deepStrictEqual(states(audit).at(-1), 'delivery_unknown#1');
  // A receipt that says not whether it is retryable is read by its errors.
  const implicit = { ...failure('network', { retryable: true }), retryable: undefined };
  const { handler: byErrors } = handlerOf({ transport: fakeTransport(() => implicit) });
  assert.strictEqual((await run(byErrors, jobOf())).type, 'retry');
  const none = { successful: false, errorMessages: ['?'] };
  const { handler: bare } = handlerOf({ transport: fakeTransport(() => none) });
  assert.deepStrictEqual(await run(bare, jobOf()), { type: 'fail', code: 'unknown', reason: '?' });
});

test('Queue: a failure of the operator is retried after a longer wait', async () => {
  const transport = fakeTransport(() => failure('auth'));
  const { handler } = handlerOf({ transport, operatorDelayMilliseconds: 600_000 });
  const outcome = await run(handler, jobOf());
  assert.deepStrictEqual([outcome.type, outcome.delayMilliseconds], ['retry', 600_000]);
  const last = await run(handler, jobOf({}, { attempt: 5 }));
  assert.strictEqual(last.code, 'queue.attempts_exhausted');
  const { handler: configuration } = handlerOf({
    transport: fakeTransport(() => failure('configuration')),
  });
  assert.strictEqual((await run(configuration, jobOf())).delayMilliseconds, 300_000);
});

test('Queue: classify decides in the place of the rules', async () => {
  const decisions = [];
  const classify = ({ receipt, job }) => {
    decisions.push([receipt.errors[0].category, job.attempt]);
    return { validation: 'retry', 'server-error': 'fail', timeout: 'delivery_unknown' }[
      receipt.errors[0].category
    ];
  };
  const cases = [
    ['validation', false, 'retry'],
    ['server-error', true, 'fail'],
    ['timeout', true, 'fail'],
    ['network', true, 'retry'],
  ];
  for (const [category, retryable, type] of cases) {
    const { handler, audit } = handlerOf({
      transport: fakeTransport(() => failure(category, { retryable })),
      classify,
    });
    assert.strictEqual((await run(handler, jobOf())).type, type, category);
    if (category === 'timeout') assert.strictEqual(states(audit).at(-1), 'delivery_unknown#1');
  }
  assert.strictEqual(decisions.length, 4);
});

test('Queue: a template that does not render fails the job, an outage of its loader is retried', async () => {
  const { handler, audit, transport } = handlerOf();
  const missing = await run(handler, jobOf({ template: 'nope' }));
  assert.strictEqual(missing.code, 'render.failed');
  assert.match(missing.reason, /No template "nope"/);
  assert.deepStrictEqual(states(audit), ['failed#1']);
  assert.strictEqual(transport.calls.length, 0);
  const noSubject = await run(handler, jobOf({ template: 'bare', idempotencyKey: 'b' }));
  assert.strictEqual(noSubject.code, 'render.no_subject');
  const { handler: noRenderer } = handlerOf({ renderer: undefined });
  assert.strictEqual((await run(noRenderer, jobOf())).code, 'render.no_renderer');
  const outage = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), {
    code: 'ECONNREFUSED',
  });
  const { handler: down } = handlerOf({ renderer: { render: () => Promise.reject(outage) } });
  assert.deepStrictEqual(
    [(await run(down, jobOf())).type, (await run(down, jobOf())).code],
    ['retry', 'render.failed'],
  );
  const flagged = Object.assign(new Error('i18n busy'), { retryable: true });
  const { handler: busy } = handlerOf({ renderer: { render: () => Promise.reject(flagged) } });
  assert.strictEqual((await run(busy, jobOf())).type, 'retry');
  const { handler: thrown } = handlerOf({
    renderer: { render: () => Promise.reject(new TemplateNotFoundError('x', [])) },
  });
  assert.strictEqual((await run(thrown, jobOf())).type, 'fail');
  const { handler: unknownFailure } = handlerOf({
    renderer: { render: () => Promise.reject(new Error('odd')) },
  });
  assert.strictEqual((await run(unknownFailure, jobOf())).type, 'fail');
});

test('Queue: attachments by reference are resolved by the application', async () => {
  const refs = [];
  const resolveAttachment = async (ref, { job, attachment, signal }) => {
    refs.push([
      ref,
      job.correlationId !== undefined,
      attachment.filename,
      signal instanceof AbortSignal,
    ]);
    if (ref === 'bytes') return new Uint8Array([7]);
    if (ref === 'attachment') {
      return {
        inline: false,
        filename: 'other',
        contentType: 'x/y',
        contentId: 'c',
        content: new Uint8Array([8]),
      };
    }
    if (ref === 'down') throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    if (ref === 'bug') throw new TypeError('bad ref');
    return 42;
  };
  const job = (ref) => jobOf({ idempotencyKey: ref, attachments: [{ filename: 'f.bin', ref }] });
  const { handler, transport } = handlerOf({ resolveAttachment });
  assert.strictEqual((await run(handler, job('bytes'))).type, 'ack');
  assert.deepStrictEqual([...transport.calls[0].message.attachments[0].content], [7]);
  assert.strictEqual(transport.calls[0].message.attachments[0].filename, 'f.bin');
  assert.strictEqual((await run(handler, job('attachment'))).type, 'ack');
  assert.deepStrictEqual([...transport.calls[1].message.attachments[0].content], [8]);
  assert.deepStrictEqual(
    [(await run(handler, job('down'))).type, (await run(handler, job('down'))).code],
    ['retry', 'queue.attachment_failed'],
  );
  assert.strictEqual((await run(handler, job('bug'))).type, 'fail');
  assert.strictEqual((await run(handler, job('nothing'))).code, 'queue.attachment_failed');
  assert.deepStrictEqual(refs[0], ['bytes', true, 'f.bin', true]);
  const { handler: unresolved } = handlerOf();
  assert.strictEqual((await run(unresolved, job('bytes'))).code, 'queue.attachment_unresolved');
});

test('Queue: a job that is not one, or of a later version, or expired, is not sent', async () => {
  const { handler, transport } = handlerOf();
  const invalid = await run(handler, { ...jobOf(), data: { v: 1 } });
  assert.deepStrictEqual([invalid.type, invalid.code], ['fail', 'queue.invalid_job']);
  const tampered = jobOf();
  tampered.data.to = [{ address: 'evil@example.com' }];
  assert.strictEqual((await run(handler, tampered)).code, 'queue.hash_mismatch');
  // A job of a later version is given back for a worker of it, its attempts
  // not spent, until it expires or has waited a week.
  const later = { ...jobOf(), data: { ...jobOf().data, v: 2 } };
  assert.deepStrictEqual(await run(handler, { ...later, attempt: 5 }), {
    type: 'release',
    delayMilliseconds: 300_000,
  });
  const week = 7 * 24 * 60 * 60 * 1000;
  const stale = await run(handler, { ...later, enqueuedAt: NOW - week - 1 });
  assert.deepStrictEqual([stale.type, stale.code], ['fail', 'queue.unsupported_version']);
  const lapsed = await run(handler, {
    ...later,
    data: { ...later.data, expiresAt: new Date(NOW - 1).toISOString() },
  });
  assert.strictEqual(lapsed.type, 'fail');
  const expired = jobOf({ expiresAt: new Date(NOW - 1) });
  assert.strictEqual((await run(handler, expired)).code, 'queue.expired');
  // A retry that would come after the job expires fails it now.
  const soon = jobOf({ expiresAt: new Date(NOW + 1000) });
  const { handler: slow } = handlerOf({
    transport: fakeTransport(() =>
      failure('server-error', { retryable: true, retryAfterMilliseconds: 60_000 }),
    ),
  });
  assert.strictEqual((await run(slow, soon)).code, 'queue.expired');
  assert.strictEqual(transport.calls.length, 0);
  // A message the worker cannot build: data that passes its checks but not createMessage.
  const broken = jobOf();
  broken.data.headers = { 'bad header': 'x' };
  broken.data.hash = hashJson(broken.data, new Set(['enqueuedAt', 'hash']));
  assert.strictEqual((await run(handler, broken)).code, 'queue.invalid_message');
});

test('Queue: what the transport throws is classified, a bug failing the job', async () => {
  const throwing = (error) => handlerOf({ transport: fakeTransport(() => ({ throw: error })) });
  const bug = throwing(new TypeError("Cannot read properties of undefined (reading 'x')"));
  assert.strictEqual((await run(bug.handler, jobOf())).code, 'queue.thrown');
  const network = throwing(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
  assert.strictEqual((await run(network.handler, jobOf())).type, 'retry');
  const unknown = throwing(markDeliveryUnknown(new Error('body unreadable after 200')));
  const outcome = await run(unknown.handler, jobOf());
  assert.deepStrictEqual([outcome.type, outcome.code], ['fail', 'delivery_unknown']);
  assert.strictEqual(states(unknown.audit).at(-1), 'delivery_unknown#1');
  const { handler } = handlerOf({ transport: fakeTransport(() => undefined) });
  assert.strictEqual((await run(handler, jobOf())).code, 'queue.invalid_receipt');
});

test('Queue: a worker that stops before the send gives the job back, after it does not', async () => {
  const stopped = new AbortController();
  stopped.abort();
  const { handler, transport } = handlerOf();
  assert.deepStrictEqual(await run(handler, jobOf(), stopped.signal), { type: 'release' });
  assert.strictEqual(transport.calls.length, 0);
  // Aborted while rendering.
  const rendering = new AbortController();
  const { handler: slowRender } = handlerOf({
    renderer: {
      render: () => {
        rendering.abort();
        return Promise.reject(new Error('aborted'));
      },
    },
  });
  assert.deepStrictEqual(await run(slowRender, jobOf(), rendering.signal), { type: 'release' });
  // Aborted while resolving an attachment.
  const resolving = new AbortController();
  const { handler: slowResolve } = handlerOf({
    resolveAttachment: () => {
      resolving.abort();
      return Promise.reject(new Error('aborted'));
    },
  });
  const attached = jobOf({ attachments: [{ filename: 'a', ref: 'r' }] });
  assert.deepStrictEqual(await run(slowResolve, attached, resolving.signal), { type: 'release' });
  // Aborted during the send: the message may be gone.
  const sending = new AbortController();
  const during = fakeTransport(() => {
    sending.abort();
    return { throw: new DOMException('aborted', 'AbortError') };
  });
  const { handler: inFlight, audit } = handlerOf({ transport: during });
  const outcome = await run(inFlight, jobOf(), sending.signal);
  assert.deepStrictEqual([outcome.type, outcome.code], ['fail', 'queue.aborted']);
  assert.strictEqual(states(audit).at(-1), 'delivery_unknown#1');
  // Aborted between rendered and submitted.
  const between = new AbortController();
  const sink = { append: (event) => (event.state === 'rendered' ? between.abort() : undefined) };
  const { handler: gap } = handlerOf({ audit: sink });
  assert.deepStrictEqual(await run(gap, jobOf(), between.signal), { type: 'release' });
});

test('Queue: checkJob refuses a job for good', async () => {
  const checkJob = (data) => {
    if (!data.from.address.endsWith('@example.com')) throw new Error('sender not allowed');
  };
  const { handler } = handlerOf({ checkJob });
  assert.strictEqual((await run(handler, jobOf())).type, 'ack');
  const refused = await run(handler, jobOf({ from: 'evil@spoof.test', idempotencyKey: 'e' }));
  assert.deepStrictEqual([refused.type, refused.code], ['fail', 'queue.refused']);
});

test('Queue: a sink that fails is a warning, or with auditStrict a retry before the send', async (t) => {
  const warnings = [];
  const listener = (warning) => warnings.push(warning.code);
  process.on('warning', listener);
  t.after(() => process.off('warning', listener));
  const broken = { append: () => Promise.reject(new Error('audit store down')) };
  const { handler, transport } = handlerOf({ audit: broken });
  assert.strictEqual((await run(handler, jobOf())).type, 'ack');
  assert.strictEqual(transport.calls.length, 1);
  const strict = handlerOf({ audit: broken, auditStrict: true });
  const outcome = await run(strict.handler, jobOf());
  assert.deepStrictEqual([outcome.type, outcome.code], ['retry', 'audit.failed']);
  assert.strictEqual(strict.transport.calls.length, 0);
  // After the send, a strict sink that fails is a warning too.
  const late = {
    append: (event) => (event.state === 'accepted' ? Promise.reject(new Error('down')) : undefined),
  };
  const afterSend = handlerOf({ audit: late, auditStrict: true });
  assert.strictEqual((await run(afterSend.handler, jobOf())).type, 'ack');
  const failingSubmit = {
    append: (event) =>
      event.state === 'submitted' ? Promise.reject(new Error('down')) : undefined,
  };
  const submit = handlerOf({ audit: failingSubmit, auditStrict: true });
  assert.strictEqual((await run(submit.handler, jobOf())).code, 'audit.failed');
  await new Promise(setImmediate);
  assert.ok(warnings.includes('MAILER_AUDIT_FAILED'));
  // Without a sink, nothing is told.
  const { handler: silent } = handlerOf({ audit: undefined });
  assert.strictEqual((await run(silent, jobOf())).type, 'ack');
});

test('Queue: the worker logs what it does, never an address', async () => {
  const records = [];
  const logger = {};
  for (const level of ['debug', 'info', 'warn', 'error']) {
    logger[level] = (record, message) => records.push({ level, message, record });
  }
  const answers = [failure('server-error', { retryable: true }), sent('p1'), failure('validation')];
  let index = 0;
  const transport = fakeTransport(() => answers[index++]);
  const { handler } = handlerOf({ transport, logger });
  await run(handler, jobOf({}, { redelivered: true }));
  await run(handler, jobOf({}, { attempt: 2 }));
  await run(handler, jobOf({ idempotencyKey: 'v' }));
  const seen = records.map(({ level, message }) => `${level} ${message}`);
  assert.deepStrictEqual(seen, [
    'warn queue.job.redelivered',
    'debug queue.job.started',
    'warn queue.job.retrying',
    'debug queue.job.started',
    'info queue.job.completed',
    'debug queue.job.started',
    'error queue.job.failed',
  ]);
  assert.strictEqual(records[2].record.code, 'x.server-error');
  assert.strictEqual(records[4].record.providerMessageId, 'p1');
  assert.strictEqual(records[6].record.code, 'x.validation');
  assert.doesNotMatch(JSON.stringify(records), /ada@example\.com/);
  // A bug of the transport is logged with its stack.
  const bug = handlerOf({
    transport: fakeTransport(() => ({ throw: new RangeError('bad') })),
    logger,
  });
  await run(bug.handler, jobOf());
  assert.ok(
    records.some(
      ({ message, record }) => message === 'queue.worker.error' && /RangeError/.test(record.stack),
    ),
  );
});

test('Queue: what escapes the steps fails the job rather than the worker', async () => {
  let calls = 0;
  const { handler } = handlerOf({
    now: () => {
      calls++;
      if (calls > 1) throw new Error('clock broke');
      return NOW;
    },
  });
  assert.deepStrictEqual(await run(handler, jobOf()), {
    type: 'fail',
    code: 'queue.thrown',
    reason: 'clock broke',
  });
});

test('Queue: the handler checks its options', () => {
  const transport = fakeTransport();
  const cases = [
    [{}, /needs a transport/],
    [{ transport, renderer: {} }, /must have render/],
    [{ transport, audit: {} }, /must have append/],
    [{ transport, rateLimitScope: 'all' }, /rateLimitScope/],
    [{ transport, auditStrict: 'yes' }, /auditStrict/],
    [{ transport, backoff: { baseDelayMilliseconds: -1 } }, /backoff\.baseDelayMilliseconds/],
    [{ transport, backoff: { factor: 0.5 } }, /backoff\.factor/],
    [{ transport, operatorDelayMilliseconds: 0 }, /operatorDelayMilliseconds/],
    [{ transport, classify: 1 }, /classify/],
  ];
  for (const [options, pattern] of cases) {
    assert.throws(() => createMailJobHandler(options), pattern);
  }
  assert.throws(() => createMailJobHandler(), /needs a transport/);
});

test('Queue: a job whose runs keep ending unsettled is given up, unsent', async () => {
  const { handler, audit, transport } = handlerOf();
  const allowed = await run(handler, jobOf({}, { redelivered: true, redeliveries: 3 }));
  assert.strictEqual(allowed.type, 'ack');
  const poison = await run(
    handler,
    jobOf({ idempotencyKey: 'p' }, { redelivered: true, redeliveries: 4 }),
  );
  assert.deepStrictEqual([poison.type, poison.code], ['fail', 'queue.redelivery_exhausted']);
  assert.strictEqual(transport.calls.length, 1);
  const last = audit.events.at(-1);
  assert.strictEqual(last.state, 'delivery_unknown');
  assert.strictEqual(last.error.code, 'queue.redelivery_exhausted');
  // A source that counts nothing is never given up for it.
  const { handler: strict } = handlerOf({ maxRedeliveries: 0 });
  assert.strictEqual((await run(strict, jobOf({ idempotencyKey: 'q' }))).type, 'ack');
  const once = await run(strict, jobOf({ idempotencyKey: 'r' }, { redeliveries: 1 }));
  assert.strictEqual(once.code, 'queue.redelivery_exhausted');
  for (const maxRedeliveries of [-1, 1.5, '3']) {
    assert.throws(() => handlerOf({ maxRedeliveries }), /maxRedeliveries must be a whole number/);
  }
});

test('Queue: under redelivered: delivery_unknown, a run again after a submit is not sent', async () => {
  const { toUuid } = require('../../src/internal/uuid.js');
  const job = jobOf({}, { redelivered: true });
  const submittedId = toUuid(`${job.id}\u00001\u0000submitted`);
  // The run before died after it told the sink it submitted.
  const audit = createMemoryAuditSink();
  audit.append({ id: submittedId, state: 'submitted', correlationId: 'c', attempt: 1 });
  const { handler, transport } = handlerOf({ audit, redelivered: 'delivery_unknown' });
  const unknown = await run(handler, job);
  assert.deepStrictEqual([unknown.type, unknown.code], ['fail', 'queue.redelivered']);
  assert.strictEqual(audit.events.at(-1).state, 'delivery_unknown');
  assert.strictEqual(transport.calls.length, 0);
  // One that died before its submit is sent.
  const { handler: fresh, transport: sending } = handlerOf({ redelivered: 'delivery_unknown' });
  assert.strictEqual((await run(fresh, job)).type, 'ack');
  assert.strictEqual(sending.calls.length, 1);
  // A sink that cannot tell, or none, sends nothing again.
  const blind = { append: () => {} };
  const { handler: unsure } = handlerOf({ audit: blind, redelivered: 'delivery_unknown' });
  assert.strictEqual((await run(unsure, job)).code, 'queue.redelivered');
  const failing = { append: () => {}, has: () => Promise.reject(new Error('down')) };
  const { handler: down } = handlerOf({ audit: failing, redelivered: 'delivery_unknown' });
  assert.strictEqual((await run(down, job)).code, 'queue.redelivered');
  // By default a run again is sent, for IdempotencyTransport to dedupe.
  const { handler: plain, transport: again } = handlerOf({ audit });
  assert.strictEqual((await run(plain, job)).type, 'ack');
  assert.strictEqual(again.calls.length, 1);
  assert.throws(() => handlerOf({ redelivered: 'never' }), /redelivered must be/);
});

test('Queue: a template that fails leaves its text in the log, not the store or the audit', async () => {
  const records = [];
  const logger = {
    debug: (record, message) => records.push([message, record.reason]),
    error: () => {},
  };
  const inputs = [];
  const renderer = {
    render(input) {
      inputs.push(input);
      throw new TemplateNotFoundError('welcome', ['welcome.hbs']);
    },
  };
  const leaky = {
    render() {
      throw Object.assign(new Error('helper failed on {"card":"4242 4242 4242 4242"}'), {
        code: 'MAILER_TEMPLATE_RENDER',
        template: 'welcome.uk.hbs',
        phase: 'render',
        engine: 'handlebars',
        retryable: false,
      });
    },
  };
  const { handler: missing } = handlerOf({ renderer, logger });
  const signal = new AbortController().signal;
  await run(missing, jobOf(), signal);
  assert.strictEqual(inputs[0].signal, signal);
  const { handler, audit } = handlerOf({ renderer: leaky, logger });
  const outcome = await run(handler, jobOf());
  assert.deepStrictEqual([outcome.type, outcome.code], ['fail', 'render.failed']);
  assert.strictEqual(
    outcome.reason,
    'The template "welcome.uk.hbs" failed (render) with handlebars.',
  );
  const event = audit.events.at(-1);
  assert.strictEqual(event.state, 'failed');
  assert.doesNotMatch(JSON.stringify(event), /4242/);
  assert.ok(
    records.some(([message, reason]) => message === 'queue.render.failed' && /4242/.test(reason)),
  );
});

test('Queue: a rate limit makes the job’s tenant wait under rateLimitScope tenant', async () => {
  const transport = fakeTransport(() =>
    failure('rate-limit', { retryable: true, retryAfterMilliseconds: 60_000 }),
  );
  const { handler } = handlerOf({ transport, rateLimitScope: 'tenant' });
  const tenanted = await run(handler, jobOf({ tenantId: 'acme' }));
  assert.deepStrictEqual([tenanted.type, tenanted.scope], ['retry', 'tenant']);
  // A job of no tenant waits alone.
  const alone = await run(handler, jobOf({ idempotencyKey: 'n' }));
  assert.strictEqual(alone.scope, 'job');
});

test('Queue: what escapes the steps is told, and each outcome logged with its duration', async (t) => {
  const warnings = [];
  const listener = (warning) => warnings.push(warning.code);
  process.on('warning', listener);
  t.after(() => process.off('warning', listener));
  const records = [];
  const logger = {
    error: (record, message) => records.push([message, record]),
    warn: (record, message) => records.push([message, record]),
    info: (record, message) => records.push([message, record]),
  };
  let clock = NOW;
  const failing = fakeTransport(() => failure('server-error', { retryable: true }));
  const { handler: retrying } = handlerOf({
    transport: failing,
    logger,
    now: () => (clock += 250),
  });
  await run(retrying, jobOf());
  const retried = records.find(([message]) => message === 'queue.job.retrying');
  assert.ok(retried[1].durationMs > 0);
  const { handler: refusing } = handlerOf({
    transport: fakeTransport(() => failure('rejected')),
    logger,
    now: () => (clock += 250),
  });
  await run(refusing, jobOf({ idempotencyKey: 'r' }));
  const failed = records.find(([message]) => message === 'queue.job.failed');
  assert.ok(failed[1].durationMs > 0);
  const broken = await run(
    createMailJobHandler({
      transport: fakeTransport(() => failure('server-error', { retryable: true })),
      renderer: templates,
      logger,
      now: () => clock,
      classify: () => {
        throw new Error('classify broke');
      },
    }),
    jobOf({ idempotencyKey: 'b' }),
  );
  assert.deepStrictEqual([broken.type, broken.code], ['fail', 'queue.thrown']);
  assert.ok(
    records.some(
      ([message, record]) => message === 'queue.worker.error' && record.reason === 'classify broke',
    ),
  );
  await new Promise(setImmediate);
  assert.ok(warnings.includes('MAILER_QUEUE_WORKER_THREW'));
});
