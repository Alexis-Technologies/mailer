// Not ported: tests of the jobs of the channels other than email in ./queue:
// the job of version 2 a producer makes, what a worker reads of it, and the
// message of its channel it sends, on the memory queue.
const { test } = require('node:test');
const assert = require('node:assert');
const { createMemoryAuditSink } = require('../../src/audit/index.js');
const {
  CHANNEL_JOB_VERSION,
  QueueError,
  createJobHandler,
  createMemoryQueue,
  createQueue,
  parseJob,
  prepareJob,
} = require('../../src/queue/index.js');
const { openJob, sealJob } = require('../../src/queue/envelope.js');
const { createMemoryLoader, createTemplateRenderer } = require('../../src/templates/index.js');
const { fakeEngine } = require('../helpers/templates/fake-engine.js');
const { fakeTransport, sent } = require('../helpers/decorators/fake.js');
const { manualClock } = require('../helpers/queue/clock.js');

const NOW = Date.parse('2026-11-08T10:00:00Z');
const now = () => NOW;
// The fields a sealed job of 1.2 keeps in clear: a worker of 1.2 refuses a
// job that holds any other beside `enc`.
const ENVELOPE_1_2 = new Set(['v', 'hash', 'enqueuedAt', 'correlationId', 'mac', 'kid', 'trace']);

const otp = (extra = {}) => ({
  channel: 'sms',
  kind: 'content',
  to: '067 123 45 67',
  text: 'Your code is 1234',
  idempotencyKey: 'otp:1',
  priority: 'high',
  ...extra,
});

const setup = (options = {}) => {
  const clock = manualClock(NOW);
  const driver = createMemoryQueue({
    now: clock.now,
    sleep: clock.sleep,
    pollIntervalMilliseconds: 1000,
  });
  const audit = createMemoryAuditSink();
  const queue = createQueue({ driver, audit, now: clock.now, defaultCountry: 'UA', ...options });
  return { clock, driver, audit, queue };
};

test('Queue channels: a job of SMS is of version 2, its recipient in E.164, named by its channel', () => {
  const { data, request } = prepareJob(otp(), { now, defaultCountry: 'UA' });
  assert.strictEqual(CHANNEL_JOB_VERSION, 2);
  assert.deepStrictEqual(data, {
    v: 2,
    channel: 'sms',
    kind: 'content',
    to: '+380671234567',
    text: 'Your code is 1234',
    priority: 'high',
    metadata: { correlationId: request.id },
    idempotencyKey: 'otp:1',
    correlationId: request.id,
    enqueuedAt: '2026-11-08T10:00:00.000Z',
    hash: data.hash,
  });
  assert.strictEqual(request.name, 'sms');
  assert.strictEqual(request.priority, 'high');
  assert.strictEqual(request.unique, true);
  // The channel ends the seed of the id: an SMS and an email under one key are
  // two jobs, and the email keeps the id of 1.2.
  const email = prepareJob(
    {
      kind: 'content',
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 's',
      content: { text: 't' },
      idempotencyKey: 'otp:1',
    },
    { now },
  );
  assert.notStrictEqual(email.request.id, request.id);
  const telegram = prepareJob(otp({ channel: 'telegram', to: 42 }), { now });
  assert.notStrictEqual(telegram.request.id, request.id);
  assert.strictEqual(parseJob(data), data);
});

test('Queue channels: a sealed job of a channel keeps its channel in enc, which 1.2 opens to a version it waits for', async () => {
  const codec = {
    encode: (text) => Buffer.from(text).toString('base64'),
    decode: (text) => Buffer.from(text, 'base64').toString(),
  };
  const { data } = prepareJob(otp(), { now, defaultCountry: 'UA' });
  const sealed = await sealJob(data, codec);
  for (const key of Object.keys(sealed)) {
    assert.ok(key === 'enc' || ENVELOPE_1_2.has(key), `${key} is in clear`);
  }
  assert.strictEqual(sealed.v, 2);
  assert.strictEqual('channel' in sealed, false);
  assert.deepStrictEqual(await openJob(sealed, codec), data);
});

test('Queue channels: a job of a channel is checked as createChannelMessage checks its message', () => {
  const refused = [
    [otp({ to: '12' }), /phone number in E\.164/],
    [otp({ subject: 'Hi' }), /A message of sms takes no subject/],
    [otp({ channel: 'pager' }), /Unknown channel: "pager"/],
    [otp({ kind: 'template', template: 'otp' }), /A template job renders its text/],
    [otp({ providerTemplate: { name: 'otp', language: 'en' } }), /sms takes no providerTemplate/],
    [otp({ media: [{ content: new Blob(['x']), contentType: 'image/png' }] }), /holds bytes/],
    [otp({ media: [{ ref: '', contentType: 'image/png' }] }), /The ref of a medium/],
    [otp({ media: [{ ref: 's3://a' }] }), /contentType/],
    [otp({ media: 'a.png' }), /media must be an array/],
    [otp({ media: [null] }), /A medium of a job is/],
    [otp({ text: undefined }), /has nothing to send/],
  ];
  for (const [input, message] of refused) {
    assert.throws(() => prepareJob(input, { now, defaultCountry: 'UA' }), message);
  }
  assert.throws(() => prepareJob(otp(), { defaultCountry: 'XX' }), /defaultCountry is no country/);
  assert.throws(() => createQueue({ driver: createMemoryQueue(), defaultCountry: 'XX' }), {
    name: 'TypeError',
  });
  // An email may say it is one.
  const email = prepareJob(
    {
      channel: 'email',
      kind: 'content',
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 's',
      content: { text: 't' },
    },
    { now },
  );
  assert.strictEqual(email.data.v, 1);
  assert.strictEqual('channel' in email.data, false);
});

test('Queue channels: the media of a job are kept as bytes, a reference or a URL, bounded', () => {
  const { data } = prepareJob(
    otp({
      channel: 'telegram',
      to: 42,
      media: [
        { content: new Uint8Array([1, 2, 3]), contentType: 'image/png', filename: 'a.png' },
        { ref: 's3://b', contentType: 'image/jpeg', caption: 'B' },
        { url: 'https://example.com/c.png' },
      ],
    }),
    { now },
  );
  assert.deepStrictEqual(data.media, [
    { data: 'AQID', contentType: 'image/png', filename: 'a.png' },
    { ref: 's3://b', contentType: 'image/jpeg', caption: 'B' },
    { url: 'https://example.com/c.png' },
  ]);
  assert.strictEqual(
    prepareJob(otp({ media: [] }), { now, defaultCountry: 'UA' }).data.media,
    undefined,
  );
  assert.throws(
    () =>
      prepareJob(otp({ media: [{ content: new Uint8Array(9), contentType: 'image/png' }] }), {
        now,
        defaultCountry: 'UA',
        maxInlineAttachmentBytes: 8,
      }),
    { name: 'RangeError', message: /The media of a job hold more than 8 bytes/ },
  );
});

test('Queue channels: a worker reads a job of a channel by its shape, and waits for a channel it does not know', () => {
  const { data } = prepareJob(otp(), { now, defaultCountry: 'UA' });
  const code = (changed) => {
    try {
      parseJob(changed);
    } catch (error) {
      assert.ok(error instanceof QueueError);
      return error.code;
    }
    return 'parsed';
  };
  assert.strictEqual(code({ ...data, channel: 'pager' }), 'queue.unsupported_version');
  assert.strictEqual(code({ ...data, channel: 'email' }), 'queue.invalid_job');
  assert.strictEqual(code({ ...data, channel: 1 }), 'queue.invalid_job');
  assert.strictEqual(code({ ...data, sticker: 'x' }), 'queue.unsupported_version');
  assert.strictEqual(code({ ...data, media: 'x' }), 'queue.invalid_job');
  assert.strictEqual(code({ ...data, media: [{ url: 'a', id: 'b' }] }), 'queue.invalid_job');
  assert.strictEqual(code({ ...data, media: [null] }), 'queue.invalid_job');
  assert.strictEqual(code({ ...data, text: 42 }), 'queue.invalid_job');
  assert.strictEqual(code({ ...data, kind: 'other' }), 'queue.invalid_job');
  assert.strictEqual(code({ ...data, text: 'Your code is 9999' }), 'queue.hash_mismatch');
  assert.strictEqual(code({ ...data, v: 3 }), 'queue.unsupported_version');
  assert.match(
    (() => {
      try {
        parseJob({ ...data, v: 3 });
      } catch (error) {
        return error.message;
      }
      return '';
    })(),
    /it reads up to 2/,
  );
});

test('Queue channels: a job of SMS is sent as a message of its channel, its states told with it', async (t) => {
  const { driver, audit, queue } = setup();
  const transport = fakeTransport(() => ({ ...sent('SM1'), state: 'accepted', segments: 1 }));
  const enqueued = await queue.enqueue(
    otp({ tenantId: 'acme', expiresAt: new Date(NOW + 300_000), tags: 'otp' }),
  );
  assert.deepStrictEqual(Object.keys(enqueued).toSorted(), [
    'channel',
    'correlationId',
    'duplicate',
    'id',
  ]);
  assert.strictEqual(enqueued.channel, 'sms');
  const worker = queue.createWorker({ transport });
  t.after(() => worker.close());
  await driver.drain();
  assert.strictEqual(transport.calls.length, 1);
  const { message } = transport.calls[0];
  assert.deepStrictEqual(
    { ...message, metadata: { ...message.metadata } },
    {
      channel: 'sms',
      to: '+380671234567',
      text: 'Your code is 1234',
      tags: ['otp'],
      priority: 'high',
      metadata: { correlationId: enqueued.correlationId },
      tenantId: 'acme',
      idempotencyKey: enqueued.id,
      expiresAt: new Date(NOW + 300_000),
    },
  );
  const events = audit.eventsOf(enqueued.correlationId);
  assert.deepStrictEqual(
    events.map((event) => event.state),
    ['queued', 'rendered', 'submitted', 'accepted'],
  );
  for (const event of events) {
    assert.strictEqual(event.channel, 'sms');
    assert.strictEqual('messageId' in event, false);
    assert.strictEqual(event.tenantId, 'acme');
  }
  assert.strictEqual(events[3].providerMessageId, 'SM1');
  // Changed after C51: without a signing key, no hash of what it says.
  assert.strictEqual('messageHash' in events[1], false);
});

test('Queue channels: the hash of what a message of a channel says is keyed, under the signing key', async (t) => {
  // Before: a SHA-256 of its recipient and text, which a million guesses turn
  // back into a code of six digits sent to a number one knows.
  const { fingerprintOf } = require('../../src/internal/fingerprint.js');
  const key = { id: 'k1', secret: 'k'.repeat(32) };
  const { driver, audit, queue } = setup({ signingKeys: [key] });
  const transport = fakeTransport(() => ({ ...sent('SM1'), state: 'accepted' }));
  const enqueued = await queue.enqueue(otp());
  const worker = queue.createWorker({ transport });
  t.after(() => worker.close());
  await driver.drain();
  const rendered = audit.eventsOf(enqueued.correlationId)[1];
  assert.strictEqual(rendered.state, 'rendered');
  assert.match(rendered.messageHash, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(rendered.messageHash, fingerprintOf(transport.calls[0].message));
});

test('Queue channels: a job of a channel that expired in its queue is told expired', async (t) => {
  // Before: it was told failed, while an SMS a carrier gave up is expired; an
  // email job keeps the state failed of 1.2.
  const { clock, driver, audit, queue } = setup();
  const transport = fakeTransport(() => ({ ...sent('SM1'), state: 'accepted' }));
  const sms = await queue.enqueue(otp({ expiresAt: new Date(NOW + 1000) }));
  const email = await queue.enqueue({
    kind: 'content',
    from: 'App <app@example.com>',
    to: 'ada@example.com',
    subject: 'Your code',
    content: { text: 'Your code is 1234' },
    idempotencyKey: 'code:1',
    expiresAt: new Date(NOW + 1000),
  });
  clock.advance(2000);
  const worker = queue.createWorker({ transport });
  t.after(() => worker.close());
  await driver.drain();
  assert.strictEqual(transport.calls.length, 0);
  assert.deepStrictEqual(
    audit.eventsOf(sms.correlationId).map((event) => event.state),
    ['queued', 'expired'],
  );
  assert.deepStrictEqual(
    audit.eventsOf(email.correlationId).map((event) => event.state),
    ['queued', 'failed'],
  );
  // So is one whose retry would come after it expires.
  const later = setup();
  const busy = fakeTransport(() => ({
    successful: false,
    errorMessages: ['busy'],
    errors: [{ message: 'busy', category: 'server-error', retryAfterMilliseconds: 60_000 }],
    retryable: true,
  }));
  const soon = await later.queue.enqueue(otp({ expiresAt: new Date(NOW + 1000) }));
  const retrying = later.queue.createWorker({ transport: busy });
  t.after(() => retrying.close());
  await later.driver.drain();
  assert.deepStrictEqual(
    later.audit.eventsOf(soon.correlationId).map((event) => event.state),
    ['queued', 'rendered', 'submitted', 'expired'],
  );
});

test('Queue channels: a receipt that says sent tells the state sent after accepted', async (t) => {
  const { driver, audit, queue } = setup();
  const transport = fakeTransport(() => ({ ...sent('ts-1'), state: 'sent' }));
  const enqueued = await queue.enqueue({ channel: 'slack', kind: 'content', text: 'Deployed' });
  const worker = queue.createWorker({ transport });
  t.after(() => worker.close());
  await driver.drain();
  assert.deepStrictEqual(
    audit.eventsOf(enqueued.correlationId).map((event) => [event.state, event.providerMessageId]),
    [
      ['queued', undefined],
      ['rendered', undefined],
      ['submitted', undefined],
      ['accepted', 'ts-1'],
      ['sent', 'ts-1'],
    ],
  );
  assert.strictEqual(audit.stateOf(enqueued.correlationId), 'sent');
});

test('Queue channels: a template renders the text of a message, the title of a push from its subject', async (t) => {
  const renderer = createTemplateRenderer({
    engine: fakeEngine(),
    loader: createMemoryLoader({
      'shipped.tpl':
        '---\nsubject: Order {{order}} shipped\n---\n<p>It is on its way: {{order}}</p>',
      'blank.tpl': '---\nsubject: Nothing\n---\n',
    }),
  });
  const { driver, audit, queue } = setup();
  const transport = fakeTransport((message, index) => sent(`p${index}`));
  const push = await queue.enqueue({
    channel: 'push',
    kind: 'template',
    template: 'shipped',
    context: { order: 'A-1' },
    to: { token: 'device-1' },
    data: { order: 'A-1' },
  });
  await queue.enqueue({
    channel: 'push',
    kind: 'template',
    template: 'shipped',
    context: { order: 'A-2' },
    to: { token: 'device-2' },
    title: 'Good news',
  });
  await queue.enqueue({
    channel: 'telegram',
    kind: 'template',
    template: 'shipped',
    context: { order: 'A-3' },
    to: 42,
  });
  const blank = await queue.enqueue({
    channel: 'telegram',
    kind: 'template',
    template: 'blank',
    to: 43,
  });
  const worker = queue.createWorker({ transport, renderer });
  t.after(() => worker.close());
  await driver.drain();
  const messages = transport.calls.map((call) => call.message);
  assert.deepStrictEqual(
    messages.map((message) => [message.channel, message.title, message.text]),
    [
      ['push', 'Order A-1 shipped', 'It is on its way: A-1'],
      ['push', 'Good news', 'It is on its way: A-2'],
      ['telegram', undefined, 'It is on its way: A-3'],
    ],
  );
  assert.deepStrictEqual({ ...messages[0].data }, { order: 'A-1' });
  assert.strictEqual(audit.stateOf(push.correlationId), 'accepted');
  const failed = audit.eventsOf(blank.correlationId).at(-1);
  assert.strictEqual(failed.state, 'failed');
  assert.strictEqual(failed.error.code, 'render.no_text');
  assert.strictEqual(driver.get(blank.id).failure.code, 'render.no_text');
});

test('Queue channels: the media of a job are resolved by resolveAttachment, as content or a URL', async (t) => {
  const { driver, queue } = setup();
  const transport = fakeTransport((message, index) => sent(`p${index}`));
  const told = [];
  const media = [
    { content: new Uint8Array([1, 2]), contentType: 'image/png', filename: 'a.png' },
    { ref: 's3://b', contentType: 'image/jpeg', caption: 'B' },
    { ref: 's3://c', contentType: 'video/mp4' },
    { ref: 's3://d', contentType: 'image/gif' },
    { id: 'media-id-1' },
  ];
  await queue.enqueue({ channel: 'telegram', kind: 'content', to: 42, media });
  const worker = queue.createWorker({
    transport,
    resolveAttachment: async (ref, context) => {
      told.push([ref, context.job.channel, context.medium, context.attachment]);
      if (ref === 's3://b') return new Uint8Array([3]);
      if (ref === 's3://c') return { content: new Uint8Array([4]) };
      return { url: `https://cdn.example.com/${ref.slice(5)}` };
    },
  });
  t.after(() => worker.close());
  await driver.drain();
  assert.deepStrictEqual(told, [
    ['s3://b', 'telegram', { contentType: 'image/jpeg', caption: 'B' }, undefined],
    ['s3://c', 'telegram', { contentType: 'video/mp4' }, undefined],
    ['s3://d', 'telegram', { contentType: 'image/gif' }, undefined],
  ]);
  assert.deepStrictEqual(transport.calls[0].message.media, [
    { content: new Uint8Array([1, 2]), contentType: 'image/png', filename: 'a.png' },
    { content: new Uint8Array([3]), contentType: 'image/jpeg', caption: 'B' },
    { content: new Uint8Array([4]), contentType: 'video/mp4' },
    { url: 'https://cdn.example.com/d', contentType: 'image/gif' },
    { id: 'media-id-1' },
  ]);
});

test('Queue channels: the audit and the reason of a failure name no recipient the provider wrote', async () => {
  // Before (C2): the reason and the audit were redacted of the numbers with a
  // +, so a provider that wrote the number without it put it in the store of
  // the queue and the append-only audit.
  const { data } = prepareJob(otp(), { now, defaultCountry: 'UA' });
  const job = { id: 'j1', name: 'sms', data, attempt: 1, maxAttempts: 3, redelivered: false };
  const audit = createMemoryAuditSink();
  const transport = fakeTransport(() => ({
    successful: false,
    errorMessages: ['SMS Club refused 380671234567: stop list'],
    errors: [{ category: 'rejected', code: 'smsclub.add_info', retryable: false, message: 'x' }],
    retryable: false,
  }));
  const outcome = await createJobHandler({ transport, audit, now })(
    job,
    new AbortController().signal,
  );
  assert.strictEqual(outcome.type, 'fail');
  assert.strictEqual(outcome.reason, 'SMS Club refused [REDACTED]: stop list');
  const failed = audit.eventsOf(data.correlationId).at(-1);
  assert.strictEqual(failed.state, 'failed');
  assert.strictEqual(failed.error.message, 'SMS Club refused [REDACTED]: stop list');
});

test('Queue channels: a medium no resolver can give fails the job, as an attachment does', async () => {
  const { data } = prepareJob(
    {
      channel: 'telegram',
      kind: 'content',
      to: 42,
      media: [{ ref: 's3://a', contentType: 'image/png', filename: 'a.png' }],
    },
    { now },
  );
  const job = { id: 'j1', name: 'telegram', data, attempt: 1, maxAttempts: 3, redelivered: false };
  const signal = new AbortController().signal;
  const transport = fakeTransport();
  const unresolved = await createJobHandler({ transport, now })(job, signal);
  assert.deepStrictEqual(unresolved, {
    type: 'fail',
    code: 'queue.attachment_unresolved',
    reason: 'The worker has no resolveAttachment for the medium a.png.',
  });
  const empty = await createJobHandler({ transport, now, resolveAttachment: () => 42 })(
    job,
    signal,
  );
  assert.deepStrictEqual(empty, {
    type: 'fail',
    code: 'queue.attachment_failed',
    reason: 'resolveAttachment gave no content for the medium a.png.',
  });
  const nameless = prepareJob(
    {
      channel: 'telegram',
      kind: 'content',
      to: 42,
      media: [{ ref: 's3://a', contentType: 'image/png' }],
    },
    { now },
  );
  const outcome = await createJobHandler({ transport, now })(
    { ...job, data: nameless.data },
    signal,
  );
  assert.strictEqual(
    outcome.reason,
    'The worker has no resolveAttachment for a medium of image/png.',
  );
  assert.strictEqual(transport.calls.length, 0);
});

test('Queue channels: a job whose message its channel refuses fails as an invalid message', async () => {
  // Written by a producer of its own, with its hash made: the worker checks
  // the message again as createChannelMessage does.
  const { hashJson } = require('../../src/internal/canonical-json.js');
  const { UNHASHED } = require('../../src/queue/job.js');
  const { data } = prepareJob(otp(), { now, defaultCountry: 'UA' });
  const forged = { ...data, to: '0671234567' };
  forged.hash = hashJson(forged, UNHASHED);
  const job = {
    id: 'j1',
    name: 'sms',
    data: forged,
    attempt: 1,
    maxAttempts: 3,
    redelivered: false,
  };
  const transport = fakeTransport();
  const outcome = await createJobHandler({ transport, now })(job, new AbortController().signal);
  assert.strictEqual(outcome.type, 'fail');
  assert.strictEqual(outcome.code, 'queue.invalid_message');
  assert.match(outcome.reason, /E\.164/);
  assert.strictEqual(transport.calls.length, 0);
});

test('Queue channels: a sealed job of a channel is opened and sent by a worker with its codec', async (t) => {
  const codec = {
    encode: (text) => Buffer.from(text).toString('base64'),
    decode: (text) => Buffer.from(text, 'base64').toString(),
  };
  const { driver, queue } = setup({ codec });
  const transport = fakeTransport(() => sent('SM1'));
  const enqueued = await queue.enqueue(otp());
  const stored = driver.get(enqueued.id).data;
  assert.strictEqual(typeof stored.enc, 'string');
  assert.strictEqual('channel' in stored, false);
  assert.strictEqual(driver.get(enqueued.id).name, 'sms');
  const worker = queue.createWorker({ transport });
  t.after(() => worker.close());
  await driver.drain();
  assert.strictEqual(transport.calls[0].message.to, '+380671234567');
});

test('Queue channels: one queue takes email and the channels, each to the transport the router picks', async (t) => {
  const { createRouter } = require('../../src/router/index.js');
  const { driver, queue } = setup();
  const email = fakeTransport(() => sent('e1'));
  const sms = fakeTransport(() => sent('s1'));
  const results = await queue.enqueueMany([
    {
      kind: 'content',
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 'Hi',
      content: { text: 'Hello' },
      idempotencyKey: 'welcome:1',
    },
    otp({ idempotencyKey: 'welcome:1' }),
  ]);
  assert.strictEqual(typeof results[0].messageId, 'string');
  assert.strictEqual(results[1].channel, 'sms');
  assert.notStrictEqual(results[0].id, results[1].id);
  const worker = queue.createWorker({ transport: createRouter({ email, sms }) });
  t.after(() => worker.close());
  await driver.drain();
  assert.strictEqual(email.calls[0].message.subject, 'Hi');
  assert.strictEqual(sms.calls[0].message.text, 'Your code is 1234');
});

test('Queue channels: every field of a message of a channel goes through its job as it was checked', async (t) => {
  const { driver, queue } = setup();
  const transport = fakeTransport((message, index) => sent(`p${index}`));
  const whatsapp = {
    channel: 'whatsapp',
    kind: 'content',
    to: '+380671234567',
    from: '+380441234567',
    providerTemplate: { name: 'otp', language: 'uk', components: [{ type: 'body' }] },
    buttons: [{ type: 'reply', text: 'Yes', id: 'yes' }],
  };
  const slack = {
    channel: 'slack',
    kind: 'content',
    to: 'C123',
    text: 'Deployed',
    payload: { blocks: [{ type: 'divider' }] },
    mentions: { everyone: false, users: ['U1'] },
    thread: '1700000000.000100',
  };
  await queue.enqueueMany([whatsapp, slack]);
  const worker = queue.createWorker({ transport });
  t.after(() => worker.close());
  await driver.drain();
  const [first, second] = transport.calls.map((call) => call.message);
  assert.deepStrictEqual(first.template, whatsapp.providerTemplate);
  assert.deepStrictEqual(first.buttons, whatsapp.buttons);
  assert.strictEqual(first.from, '+380441234567');
  assert.deepStrictEqual(second.payload, slack.payload);
  assert.deepStrictEqual(second.mentions, slack.mentions);
  assert.strictEqual(second.thread, slack.thread);
  assert.strictEqual(second.to, 'C123');
});

test('Queue channels: a log of a job done keeps no recipient of the id of its message', async (t) => {
  // Before: Telegram's id, `<chat>:<message>`, was logged whole; the audit
  // keeps it, by which the events of the provider find their message.
  const { driver, audit, queue } = setup();
  const transport = fakeTransport(() => ({ ...sent('987654321:42'), state: 'sent' }));
  const enqueued = await queue.enqueue({
    channel: 'telegram',
    kind: 'content',
    to: 987654321,
    text: 'Hi',
    idempotencyKey: 'hi:1',
  });
  const records = [];
  const logger = {
    info: (properties, message) => records.push([message, properties]),
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  const worker = queue.createWorker({ transport, logger });
  t.after(() => worker.close());
  await driver.drain();
  const completed = records.find((record) => record[0] === 'queue.job.completed');
  assert.strictEqual(completed[1].providerMessageId, '[REDACTED]:42');
  const accepted = audit.eventsOf(enqueued.correlationId)[3];
  assert.strictEqual(accepted.providerMessageId, '987654321:42');
});

test('Queue channels: the reason of a failure thrown by the transport names no recipient', async (t) => {
  // Before: fail() redacted the reason of addresses and numbers with a + alone,
  // so a thrown error naming the chat id was told to the audit and the log.
  const { markDeliveryUnknown } = require('../../src/internal/delivery-unknown.js');
  const { driver, audit, queue } = setup();
  const transport = {
    id: 'telegram',
    send: async () => {
      throw markDeliveryUnknown(new Error('Telegram: no answer for chat 987654321'));
    },
    async *sendMany() {},
  };
  const enqueued = await queue.enqueue({
    channel: 'telegram',
    kind: 'content',
    to: 987654321,
    text: 'Hi',
    idempotencyKey: 'hi:2',
  });
  const records = [];
  const logger = {
    error: (properties, message) => records.push([message, properties]),
    info: () => {},
    warn: () => {},
    debug: () => {},
  };
  const worker = queue.createWorker({ transport, logger });
  t.after(() => worker.close());
  await driver.drain();
  const events = audit.eventsOf(enqueued.correlationId);
  const last = events[events.length - 1];
  assert.strictEqual(last.state, 'delivery_unknown');
  assert.strictEqual(last.error.message, 'Telegram: no answer for chat [REDACTED]');
  const failed = records.find((record) => record[0] === 'queue.job.failed');
  assert.ok(!JSON.stringify(failed).includes('987654321'));
});
