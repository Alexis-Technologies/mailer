// Not ported: tests of the jobs of ./queue, as they are made and read.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  MAIL_JOB_NAME,
  MAIL_JOB_VERSION,
  MailQueueError,
  parseMailJob,
  prepareMailJob,
} = require('../../src/queue/index.js');

const NOW = Date.parse('2026-10-18T09:00:00Z');
const base = {
  kind: 'template',
  template: 'reset-password',
  context: { name: 'Ada', url: 'https://example.com/r?t=1' },
  from: 'App <app@example.com>',
  to: 'ada@example.com',
};
const prepare = (input, options) =>
  prepareMailJob({ ...base, ...input }, { now: () => NOW, ...options });

test('Queue: a template job holds its fields as JSON, its ids fixed', () => {
  const { data, request } = prepare({
    idempotencyKey: 'reset:42',
    cc: ['Bob <bob@example.com>'],
    tags: ['auth'],
    headers: { 'X-Campaign': 'reset' },
    priority: 'high',
    locale: 'uk',
    tenantId: 'acme',
    metadata: { userId: '42' },
    date: new Date('2026-10-18T08:00:00Z'),
    inReplyTo: '<a@example.com>',
    tracking: { opens: false },
    list: { unsubscribe: { url: 'https://example.com/u', comment: 'one click' }, oneClick: true },
  });
  assert.strictEqual(data.v, MAIL_JOB_VERSION);
  assert.strictEqual(data.kind, 'template');
  assert.deepStrictEqual(data.from, { name: 'App', address: 'app@example.com' });
  assert.deepStrictEqual(data.to, [{ address: 'ada@example.com' }]);
  assert.deepStrictEqual(data.cc, [{ name: 'Bob', address: 'bob@example.com' }]);
  assert.deepStrictEqual(data.context, base.context);
  assert.deepStrictEqual(data.headers, { 'x-campaign': 'reset' });
  assert.deepStrictEqual(data.list, {
    unsubscribe: { url: 'https://example.com/u', comment: 'one click' },
    oneClick: true,
  });
  assert.deepStrictEqual(data.tracking, { opens: false });
  assert.deepStrictEqual(data.inReplyTo, ['a@example.com']);
  assert.strictEqual(data.date, '2026-10-18T08:00:00.000Z');
  assert.strictEqual(data.enqueuedAt, '2026-10-18T09:00:00.000Z');
  assert.strictEqual(data.metadata.userId, '42');
  assert.strictEqual(data.metadata.correlationId, data.correlationId);
  assert.strictEqual(data.correlationId, request.id);
  assert.match(data.messageId, /^[0-9a-f-]{36}@example\.com$/);
  assert.match(request.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepStrictEqual(
    { name: request.name, priority: request.priority, maxAttempts: request.maxAttempts },
    { name: MAIL_JOB_NAME, priority: 'high', maxAttempts: 5 },
  );
  assert.strictEqual(request.unique, true);
  assert.strictEqual(request.hash, data.hash);
  assert.strictEqual(request.enqueuedAt, NOW);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(data)), data);
  // The address goes into no key.
  assert.doesNotMatch(request.id, /ada/);
});

test('Queue: under one key the same message is the same job, its hash too', () => {
  const first = prepare({
    idempotencyKey: 'k1',
    attachments: [{ filename: 'a.txt', content: new Uint8Array([1]) }],
  });
  const again = prepareMailJob(
    {
      ...base,
      idempotencyKey: 'k1',
      attachments: [{ filename: 'a.txt', content: new Uint8Array([1]) }],
    },
    { now: () => NOW + 60_000 },
  );
  assert.strictEqual(again.request.id, first.request.id);
  assert.strictEqual(again.data.messageId, first.data.messageId);
  assert.strictEqual(again.data.attachments[0].contentId, first.data.attachments[0].contentId);
  assert.strictEqual(again.data.hash, first.data.hash, 'enqueuedAt is not hashed');
  // Another message under the key has another hash; another tenant another id.
  assert.notStrictEqual(
    prepare({ idempotencyKey: 'k1', to: 'bob@example.com' }).data.hash,
    first.data.hash,
  );
  assert.notStrictEqual(
    prepare({ idempotencyKey: 'k1', tenantId: 't2' }).request.id,
    first.request.id,
  );
  assert.notStrictEqual(
    prepare({ idempotencyKey: 'k1' }, { namespace: 'other' }).request.id,
    first.request.id,
  );
  // Without a key, each job is its own, its ids drawn from the generator.
  let n = 0;
  const generated = prepare({}, { generateId: (kind) => `${kind}-${n++}` });
  assert.strictEqual(generated.request.unique, false);
  assert.strictEqual(generated.data.idempotencyKey, 'idempotency-key-0');
  assert.strictEqual(generated.data.messageId, 'message-id-1@example.com');
  assert.notStrictEqual(prepare({}).request.id, prepare({}).request.id);
});

test('Queue: the hash of a job does not depend on the order of its fields', () => {
  const a = prepare({ idempotencyKey: 'k', context: { a: 1, b: { c: [1, { d: 2 }] } } });
  const b = prepare({ idempotencyKey: 'k', context: { b: { c: [1, { d: 2 }] }, a: 1 } });
  assert.strictEqual(a.data.hash, b.data.hash);
  assert.match(a.data.hash, /^[0-9a-f]{64}$/);
});

test('Queue: a context that JSON would change is refused with its path', () => {
  const cases = [
    [{ when: new Date() }, /context\.when is a Date; pass an ISO string/],
    [{ ids: new Set([1]) }, /context\.ids is a Set/],
    [{ map: new Map() }, /context\.map is a Map/],
    [{ n: Number.NaN }, /context\.n is NaN/],
    [{ n: Infinity }, /context\.n is Infinity/],
    [{ f: () => 1 }, /context\.f is a function/],
    [{ big: 1n }, /context\.big is a bigint/],
    [{ list: [1, undefined] }, /context\.list\[1\] is undefined/],
    [{ deep: { x: new (class User {})() } }, /context\.deep\.x is an instance of User/],
  ];
  for (const [context, pattern] of cases) assert.throws(() => prepare({ context }), pattern);
  const cyclic = { a: {} };
  cyclic.a.self = cyclic;
  assert.throws(() => prepare({ context: cyclic }), /refers to itself/);
  let deep = {};
  const root = deep;
  for (let index = 0; index < 40; index++) deep = deep.next = {};
  assert.throws(() => prepare({ context: root }), /nested more than 32/);
  assert.throws(() => prepare({ context: [1] }), /context must be an object/);
  // undefined in an object is left out; null and a null-prototype object stay.
  const plain = Object.assign(Object.create(null), { x: 1 });
  assert.deepStrictEqual(prepare({ context: { a: undefined, b: null, plain } }).data.context, {
    b: null,
    plain: { x: 1 },
  });
});

test('Queue: attachments go as bytes in base64, bounded, or as a reference', () => {
  const { data } = prepare({
    attachments: [
      { filename: 'a.txt', content: new TextEncoder().encode('hi'), contentType: 'text/plain' },
      {
        filename: 'logo.png',
        ref: 's3://bucket/logo.png',
        inline: true,
        contentId: 'logo@example.com',
      },
    ],
  });
  assert.deepStrictEqual(data.attachments[0], {
    filename: 'a.txt',
    contentType: 'text/plain',
    inline: false,
    contentId: data.attachments[0].contentId,
    data: 'aGk=',
  });
  assert.match(data.attachments[0].contentId, /@example\.com$/);
  assert.deepStrictEqual(data.attachments[1], {
    filename: 'logo.png',
    contentType: 'application/octet-stream',
    inline: true,
    contentId: 'logo@example.com',
    ref: 's3://bucket/logo.png',
  });
  assert.throws(
    () =>
      prepare(
        { attachments: [{ filename: 'big', content: new Uint8Array(11) }] },
        { maxInlineAttachmentBytes: 10 },
      ),
    /more than 10 bytes; give larger ones as \{ ref \}/,
  );
  assert.throws(
    () => prepare({ attachments: [{ filename: 'x' }] }),
    /needs content as bytes, or a ref/,
  );
  assert.throws(
    () => prepare({ attachments: [{ filename: 'x', content: 'text' }] }),
    /needs content/,
  );
  assert.throws(
    () => prepare({ attachments: [{ filename: 'x', ref: 'r', content: new Uint8Array() }] }),
    /needs content/,
  );
  assert.throws(
    () => prepare({ attachments: [{ content: new Uint8Array() }] }),
    /needs its filename/,
  );
  assert.throws(() => prepare({ attachments: [null] }), /\{ filename, content \}/);
  assert.throws(() => prepare({ attachments: {} }), /must be an array/);
  assert.throws(
    () => prepare({ attachments: [{ filename: 'x', ref: 'r', inline: 'yes' }] }),
    /invalid contentType, inline or contentId/,
  );
  assert.throws(
    () => prepare({ attachments: [{ filename: 'x', ref: 'r', contentId: 'a\r\nBcc: x' }] }),
    /content ID/,
  );
});

test('Queue: a job is checked as createMessage checks a message, before it is enqueued', () => {
  assert.throws(() => prepare({ to: 'not an address' }), /Invalid recipient address/);
  assert.throws(() => prepare({ headers: { 'X-A': 'a\r\nBcc: evil@example.com' } }), TypeError);
  assert.throws(
    () => prepare({ headers: { 'Message-ID': '<x@y>' } }),
    /as messageId, not as a header/,
  );
  assert.throws(() => prepare({ metadata: { 'bad key': 'x' } }), /Invalid metadata key/);
  assert.throws(() => prepare({ correlationId: 'a', metadata: { correlationId: 'b' } }), /differ/);
  assert.throws(() => prepare({ scheduledAt: 'tomorrow' }), /scheduledAt must be a Date/);
  assert.throws(() => prepare({ expiresAt: new Date('nope') }), /expiresAt must be a Date/);
  assert.throws(() => prepare({ maxAttempts: 0 }), /maxAttempts/);
  assert.throws(() => prepare({ tenantId: '' }), /tenantId must be a string/);
  assert.throws(() => prepare({ idempotencyKey: 'a\nb' }), /idempotencyKey/);
  assert.throws(() => prepare({ template: '' }), /template must be a name/);
  assert.throws(() => prepare({ locale: 1 }), /locale/);
  assert.throws(() => prepareMailJob(null), /A job is/);
  assert.throws(() => prepareMailJob({ kind: 'sms' }), /A job is/);
  assert.throws(() => prepare({}, { maxAttempts: 0 }), /maxAttempts must be a positive integer/);
  assert.throws(() => prepare({}, { namespace: '' }), /namespace/);
  assert.throws(
    () => prepare({ context: { blob: 'x'.repeat(300) } }, { maxJobBytes: 200 }),
    RangeError,
  );
  // The correlation id of the metadata is taken, and scheduledAt is a delay.
  const at = new Date(NOW + 3_600_000);
  const { data, request } = prepare({
    metadata: { correlationId: 'order-7' },
    scheduledAt: at,
    expiresAt: at,
    maxAttempts: 2,
  });
  assert.strictEqual(data.correlationId, 'order-7');
  assert.strictEqual(data.notBefore, at.toISOString());
  assert.strictEqual(data.expiresAt, at.toISOString());
  assert.strictEqual(request.availableAt, at.getTime());
  assert.strictEqual(request.maxAttempts, 2);
});

test('Queue: a content job carries its subject and content', () => {
  const { data } = prepareMailJob({
    kind: 'content',
    from: 'app@example.com',
    to: 'a@example.com',
    subject: 'Hi',
    content: { html: '<p>Hi</p>' },
  });
  assert.deepStrictEqual(
    [data.kind, data.subject, data.content],
    ['content', 'Hi', { html: '<p>Hi</p>' }],
  );
  const text = prepareMailJob({
    kind: 'content',
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 's',
    content: { text: 't' },
  });
  assert.deepStrictEqual(text.data.content, { text: 't' });
  const both = prepareMailJob({
    kind: 'content',
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 's',
    content: { html: 'h', text: 't' },
  });
  assert.deepStrictEqual(both.data.content, { html: 'h', text: 't' });
  assert.throws(
    () =>
      prepareMailJob({
        kind: 'content',
        from: 'a@example.com',
        to: 'b@example.com',
        content: { text: 't' },
      }),
    /needs its subject/,
  );
  assert.throws(
    () =>
      prepareMailJob({
        kind: 'content',
        from: 'a@example.com',
        to: 'b@example.com',
        subject: 's',
        content: {},
      }),
    /one of them at least/,
  );
  assert.throws(
    () =>
      prepareMailJob({
        kind: 'content',
        from: 'a@example.com',
        to: 'b@example.com',
        subject: 's',
        content: { html: 1 },
      }),
    /one of them at least/,
  );
});

test('Queue: a job read from its store is checked, its hash among it', () => {
  const { data } = prepare({ idempotencyKey: 'k' });
  const copy = JSON.parse(JSON.stringify(data));
  assert.deepStrictEqual(parseMailJob(copy), copy);
  const refusals = [
    [null, 'queue.invalid_job'],
    [{ ...copy, v: 0 }, 'queue.invalid_job'],
    [{ ...copy, v: 2 }, 'queue.unsupported_version'],
    [{ ...copy, kind: 'sms' }, 'queue.invalid_job'],
    [{ ...copy, template: 1 }, 'queue.invalid_job'],
    [{ ...copy, context: [] }, 'queue.invalid_job'],
    [{ ...copy, from: 'x' }, 'queue.invalid_job'],
    [{ ...copy, to: [] }, 'queue.invalid_job'],
    [{ ...copy, cc: 'x' }, 'queue.invalid_job'],
    [{ ...copy, attachments: {} }, 'queue.invalid_job'],
    [
      {
        ...copy,
        attachments: [{ filename: 'a', contentType: 't', contentId: 'c', inline: false }],
      },
      'queue.invalid_job',
    ],
    [{ ...copy, subject: 1 }, 'queue.invalid_job'],
    [{ ...copy, messageId: undefined }, 'queue.invalid_job'],
    [{ ...copy, metadata: null }, 'queue.invalid_job'],
    [{ ...copy, to: [{ address: 'evil@example.com' }] }, 'queue.hash_mismatch'],
  ];
  for (const [value, code] of refusals) {
    assert.throws(
      () => parseMailJob(value),
      (error) => error instanceof MailQueueError && error.code === code,
      JSON.stringify(value)?.slice(0, 60),
    );
  }
  const content = prepareMailJob({
    kind: 'content',
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 's',
    content: { text: 't' },
  }).data;
  assert.strictEqual(parseMailJob(content), content);
  assert.throws(() => parseMailJob({ ...content, content: null }), /no subject or content/);
});

test('Queue: a job holds only the fields of its version', () => {
  const { V1_KEYS } = require('../../src/queue/job.js');
  const template = prepare({
    idempotencyKey: 'all',
    cc: 'c@example.com',
    bcc: 'd@example.com',
    replyTo: 'e@example.com',
    subject: 'Hi',
    attachments: [{ filename: 'a.txt', content: new Uint8Array([1]) }],
    priority: 'low',
    tags: ['t'],
    headers: { 'X-A': 'b' },
    list: { unsubscribe: { url: 'https://example.com/u' } },
    messageId: '<m@example.com>',
    date: new Date(NOW),
    inReplyTo: '<a@example.com>',
    references: '<a@example.com>',
    calendar: { content: 'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR' },
    tracking: { opens: false },
    metadata: { a: 'b' },
    tenantId: 'acme',
    locale: 'uk',
    scheduledAt: new Date(NOW + 1000),
    expiresAt: new Date(NOW + 2000),
  }).data;
  const content = prepareMailJob({
    kind: 'content',
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 's',
    content: { html: '<p>h</p>', text: 't' },
  }).data;
  for (const data of [template, content]) {
    for (const key of Object.keys(data)) assert.ok(V1_KEYS.has(key), key);
  }
});

test('Queue: a field a later version adds makes the job wait, not fail its hash', () => {
  const { data } = prepare({ idempotencyKey: 'later' });
  assert.throws(
    () => parseMailJob({ ...data, priorityClass: 'bulk' }),
    (error) =>
      error instanceof MailQueueError &&
      error.code === 'queue.unsupported_version' &&
      /priorityClass/.test(error.message),
  );
  // What is written over a job once it is made does not change its hash.
  const traced = { ...data, trace: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' };
  assert.strictEqual(parseMailJob(traced), traced);
  assert.throws(
    () => parseMailJob({ ...data, trace: 1 }),
    (error) => error.code === 'queue.invalid_job',
  );
});

test('Queue: deriveId makes the ids a job derives, the same for the same key', async () => {
  const { createMailQueue, createMemoryQueue } = require('../../src/queue/index.js');
  const seeds = [];
  // A deterministic format of the application's: a prefix and part of the hash.
  const deriveId = (kind, seed) => {
    seeds.push([kind, seed]);
    return kind === 'job-id' ? `job_${seed.slice(0, 26)}` : `m${seed.slice(0, 24)}`;
  };
  const keyed = prepare(
    {
      idempotencyKey: 'welcome:42',
      attachments: [{ filename: 'a.png', content: new Uint8Array([1]), inline: true }],
    },
    { deriveId },
  );
  assert.match(keyed.request.id, /^job_[0-9a-f]{26}$/);
  assert.match(keyed.data.messageId, /^m[0-9a-f]{24}@example\.com$/);
  assert.match(keyed.data.attachments[0].contentId, /^m[0-9a-f]{24}@example\.com$/);
  assert.strictEqual(keyed.data.correlationId, keyed.request.id);
  // The seed is a hash: it holds no key as given.
  for (const [, seed] of seeds) {
    assert.match(seed, /^[0-9a-f]{64}$/);
    assert.ok(!seed.includes('welcome'));
  }
  // Without a key, the job id is derived from the generated key, and the
  // Message-ID drawn from generateId, as before.
  let drawn = 0;
  const generateId = (kind) => `g${kind.replace('-', '')}${++drawn}`;
  const unkeyed = prepare({}, { deriveId, generateId });
  assert.match(unkeyed.request.id, /^job_/);
  assert.match(unkeyed.data.messageId, /^gmessageid\d+@example\.com$/);
  // The same message under its key is the same job, a duplicate.
  const queue = createMailQueue({ driver: createMemoryQueue(), deriveId, now: () => NOW });
  const input = { ...base, idempotencyKey: 'welcome:42' };
  const first = await queue.enqueue(input);
  const again = await queue.enqueue(input);
  assert.deepStrictEqual([first.duplicate, again.duplicate, again.id], [false, true, first.id]);
  // Under idSecret, the seed of the job id is its HMAC: another id.
  const secret = prepare({ idempotencyKey: 'welcome:42' }, { deriveId, idSecret: 's'.repeat(32) });
  assert.notStrictEqual(secret.request.id, keyed.request.id);
  // By default, the UUIDs of before.
  assert.strictEqual(
    prepare({ idempotencyKey: 'welcome:42' }).request.id,
    prepare({ idempotencyKey: 'welcome:42' }, { deriveId: undefined }).request.id,
  );
});

test('Queue: deriveId must derive, and give ids a driver and a header field take', () => {
  let count = 0;
  const generating = () => `job_${++count}`;
  assert.throws(
    () => prepare({ idempotencyKey: 'k' }, { deriveId: generating }),
    /deriveId gave another job-id for the same seed: it must derive, not generate/,
  );
  const refusals = [
    [(kind, seed) => (kind === 'job-id' ? `job:${seed}` : seed), /Invalid job-id/],
    [(kind, seed) => (kind === 'job-id' ? '12345' : seed), /Invalid job-id/],
    [(kind, seed) => (kind === 'job-id' ? 'x'.repeat(129) : seed), /Invalid job-id/],
    [(kind, seed) => (kind === 'job-id' ? `j${seed}` : `a b${seed}`), /Invalid message-id/],
    [() => 42, /Invalid job-id/],
  ];
  for (const [deriveId, pattern] of refusals) {
    assert.throws(() => prepare({ idempotencyKey: 'k' }, { deriveId }), pattern);
  }
  assert.throws(() => prepare({}, { deriveId: 'uuid' }), /deriveId must be a function/);
});
