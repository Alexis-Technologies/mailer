// Not ported: the values 1.2 wrote that 2.0 keeps byte for byte: the
// fingerprint of a message, the jobs of ./queue (their JSON, hash, HMAC, id,
// Message-ID and Content-IDs), the envelope of a sealed job, the ids of audit
// events, the ranks of the states and the keys of ./idempotency. Each value
// was computed by 1.2.1: a store, an audit log or a worker of 1.2 holds them,
// so a test here that fails is a break of compatibility, not a value to
// update.
const { test } = require('node:test');
const assert = require('node:assert');
const { Buffer } = require('node:buffer');
const { createMessage } = require('../../src/index.js');
const { auditEventOfDeliveryEvent, createMemoryAuditSink } = require('../../src/audit/index.js');
const { rankOf } = require('../../src/audit/states.js');
const {
  IdempotencyTransport,
  createMemoryIdempotencyStore,
} = require('../../src/idempotency/index.js');
const { fingerprintOf } = require('../../src/internal/fingerprint.js');
const {
  createJobHandler,
  createQueue,
  createMemoryQueue,
  prepareJob,
} = require('../../src/queue/index.js');
const { createMemoryLoader, createTemplateRenderer } = require('../../src/templates/index.js');
const { fakeEngine } = require('../helpers/templates/fake-engine.js');
const { fakeTransport, sent } = require('../helpers/decorators/fake.js');
const { manualClock } = require('../helpers/queue/clock.js');
const JOB_V1 = require('../fixtures/queue/mail-job-v1.json');
const SEALED_JOB_V1 = require('../fixtures/queue/mail-job-v1-sealed.json');

const NOW = Date.parse('2026-10-18T09:00:00Z');
const SIGNING_KEYS = [{ id: 'k1', secret: 'a-signing-secret-of-32-bytes-at-least!' }];
const CODEC = {
  encode: (text) => Buffer.from(text).toString('base64'),
  decode: (text) => Buffer.from(text, 'base64').toString(),
};

const email = () => ({
  from: { name: 'Hirevel', address: 'no-reply@example.com' },
  to: ['ada@example.com', 'Grace <grace@example.org>'],
  cc: 'cc@example.com',
  bcc: 'bcc@example.com',
  replyTo: 'support@example.com',
  subject: 'Your code',
  content: { html: '<p>Code 1234</p>', text: 'Code 1234' },
  priority: 'high',
  tags: ['auth', 'otp'],
  headers: { 'X-Campaign': 'spring' },
  list: { unsubscribe: 'https://example.com/u', oneClick: true },
  attachments: [
    {
      inline: true,
      filename: 'logo.png',
      content: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
      contentId: 'logo@example.com',
    },
  ],
  messageId: '<golden@example.com>',
  date: new Date('2026-10-18T09:00:00Z'),
  inReplyTo: '<prev@example.com>',
  references: ['<first@example.com>', '<prev@example.com>'],
  scheduledAt: new Date('2026-10-19T09:00:00Z'),
  tracking: { opens: false, clicks: true },
  metadata: { correlationId: 'order-42', b: '2', a: '1' },
});

const EMAIL_FINGERPRINT = '1d346d946823a79d9236276b10e93e3ca502edd198aff3ecc1c30f2296f553c3';

// The input `tests/fixtures/queue/mail-job-v1.json` was made of.
const receiptJob = () => ({
  kind: 'content',
  subject: 'Your receipt',
  content: { html: '<p>Paid</p>', text: 'Paid' },
  from: 'Hirevel <billing@example.com>',
  to: ['ada@example.com', 'Grace <grace@example.org>'],
  replyTo: 'support@example.com',
  attachments: [
    {
      filename: 'receipt.txt',
      contentType: 'text/plain',
      content: new Uint8Array([80, 97, 105, 100]),
    },
    {
      filename: 'logo.png',
      contentType: 'image/png',
      inline: true,
      content: new Uint8Array([137, 80, 78, 71]),
    },
  ],
  priority: 'high',
  tags: ['receipt'],
  headers: { 'X-Campaign': 'spring' },
  list: { unsubscribe: 'https://example.com/u', oneClick: true },
  inReplyTo: '<order-42@example.com>',
  tracking: { opens: false },
  metadata: { plan: 'pro' },
  idempotencyKey: 'receipt:42',
  tenantId: 'acme',
  expiresAt: new Date('2026-10-25T09:00:00Z'),
});

const runOf = (fixture) => ({
  id: fixture.request.id,
  name: fixture.request.name,
  data: structuredClone(fixture.data),
  attempt: 1,
  maxAttempts: fixture.request.maxAttempts,
  enqueuedAt: fixture.request.enqueuedAt,
  redelivered: false,
  tenantId: fixture.request.tenantId,
});

test('Golden: the fingerprint of an email message', () => {
  assert.strictEqual(fingerprintOf(createMessage(email())), EMAIL_FINGERPRINT);
  assert.strictEqual(
    fingerprintOf(
      createMessage({
        from: 'a@example.com',
        to: 'b@example.com',
        subject: '',
        content: { text: '' },
      }),
    ),
    'c2331401f3321c60c2f314d06b315fd46301c6c942ec599f2390d77c6969c626',
  );
  assert.strictEqual(
    fingerprintOf({
      envelope: { from: 'a@example.com', to: ['b@example.com', 'c@example.com'] },
      content: new Uint8Array(0),
    }),
    '0ca6d9450177debf2d7a3c0f60e0a68c525f1d3b4995645456b0ae09a8d28f0f',
  );
});

test('Golden: the fingerprint of a message reads neither its tenant nor its channel', () => {
  // A job 1.2 began to send under a key is looked up after the upgrade by the
  // same fingerprint, whatever tenant or channel 2.0 gives its message.
  const message = createMessage({ ...email(), tenantId: 'acme' });
  assert.strictEqual(fingerprintOf(message), EMAIL_FINGERPRINT);
  assert.strictEqual(
    fingerprintOf({ ...message, channel: 'email', tenantId: 'other' }),
    EMAIL_FINGERPRINT,
  );
});

test('Golden: createMessage gives the fields of 1.2', () => {
  const message = createMessage(email());
  const fields = [];
  for (const key of Object.keys(message)) {
    if (key !== 'channel' && key !== 'tenantId') fields.push(key);
  }
  assert.deepStrictEqual(fields, [
    'sender',
    'recipients',
    'ccRecipients',
    'bccRecipients',
    'replyRecipients',
    'attachments',
    'subject',
    'content',
    'priority',
    'tags',
    'headers',
    'idempotencyKey',
    'messageId',
    'date',
    'inReplyTo',
    'references',
    'calendar',
    'scheduledAt',
    'tracking',
    'metadata',
  ]);
  assert.deepStrictEqual(
    [...message.headers],
    [
      ['list-unsubscribe', '<https://example.com/u>'],
      ['list-unsubscribe-post', 'List-Unsubscribe=One-Click'],
      ['x-campaign', 'spring'],
    ],
  );
  assert.deepStrictEqual(message.sender, { name: 'Hirevel', address: 'no-reply@example.com' });
  assert.deepStrictEqual(message.recipients, [
    { address: 'ada@example.com' },
    { name: 'Grace', address: 'grace@example.org' },
  ]);
  assert.strictEqual(message.messageId, 'golden@example.com');
  assert.deepStrictEqual(message.references, ['first@example.com', 'prev@example.com']);
});

test('Golden: a job of a template under a key, a tenant and a signing key', () => {
  const { data, request } = prepareJob(
    {
      kind: 'template',
      template: 'welcome',
      context: { name: 'Ada', n: 1 },
      locale: 'uk',
      from: 'Hirevel <no-reply@example.com>',
      to: ['ada@example.com'],
      cc: 'cc@example.com',
      attachments: [
        { filename: 'a.txt', content: new Uint8Array([104, 105]) },
        { filename: 'b.pdf', contentType: 'application/pdf', ref: 's3://b', inline: true },
      ],
      priority: 'high',
      tags: ['welcome'],
      headers: { 'X-Campaign': 'spring' },
      metadata: { plan: 'pro' },
      idempotencyKey: 'welcome:1',
      tenantId: 'acme',
      scheduledAt: new Date('2026-10-18T10:00:00Z'),
      expiresAt: new Date('2026-10-19T10:00:00Z'),
    },
    { now: () => NOW, signingKeys: SIGNING_KEYS },
  );
  const id = '123c0bd8-b9b3-4d37-87ee-4fdf3e3ba373';
  const hash = '5ac75e537418c3e639a8eed955b756dc111ca48c7b1c33594aa9b645cf1a2de4';
  assert.strictEqual(
    JSON.stringify(data),
    JSON.stringify({
      v: 1,
      kind: 'template',
      template: 'welcome',
      context: { name: 'Ada', n: 1 },
      locale: 'uk',
      from: { name: 'Hirevel', address: 'no-reply@example.com' },
      to: [{ address: 'ada@example.com' }],
      cc: [{ address: 'cc@example.com' }],
      attachments: [
        {
          filename: 'a.txt',
          contentType: 'application/octet-stream',
          inline: false,
          contentId: '2956cc5f-8ec0-4c43-826d-e0ce5904f799@example.com',
          data: 'aGk=',
        },
        {
          filename: 'b.pdf',
          contentType: 'application/pdf',
          inline: true,
          contentId: 'ba5f16ee-a184-4cbc-a4cb-dbe6726db63e@example.com',
          ref: 's3://b',
        },
      ],
      priority: 'high',
      tags: ['welcome'],
      headers: { 'x-campaign': 'spring' },
      messageId: '2570e9da-ad4f-4f76-ac44-cead3971cd7e@example.com',
      metadata: { plan: 'pro', correlationId: id },
      idempotencyKey: 'welcome:1',
      tenantId: 'acme',
      correlationId: id,
      notBefore: '2026-10-18T10:00:00.000Z',
      expiresAt: '2026-10-19T10:00:00.000Z',
      enqueuedAt: '2026-10-18T09:00:00.000Z',
      hash,
      kid: 'k1',
      mac: '487e3b126af486d9c7db4314d38c4cd1d8e3de129520849c302431f234cffe8a',
    }),
  );
  const { data: requestData, ...rest } = request;
  assert.strictEqual(requestData, data);
  assert.deepStrictEqual(rest, {
    id,
    name: 'mail',
    hash,
    priority: 'high',
    maxAttempts: 5,
    enqueuedAt: NOW,
    unique: true,
    availableAt: Date.parse('2026-10-18T10:00:00Z'),
    tenantId: 'acme',
  });
});

test('Golden: a job of content under idSecret and a namespace', () => {
  const { data, request } = prepareJob(
    {
      kind: 'content',
      subject: 'Receipt',
      content: { text: 'Paid' },
      from: 'billing@example.com',
      to: 'ada@example.com',
      idempotencyKey: 'receipt:7',
    },
    { now: () => NOW, namespace: 'billing', idSecret: 'an-id-secret-of-thirty-two-bytes!!' },
  );
  const id = 'ac030461-0d7a-443e-a25a-cc815ebb4612';
  assert.strictEqual(
    JSON.stringify(data),
    JSON.stringify({
      v: 1,
      kind: 'content',
      content: { text: 'Paid' },
      from: { address: 'billing@example.com' },
      to: [{ address: 'ada@example.com' }],
      subject: 'Receipt',
      priority: 'normal',
      messageId: '6a3a46fe-e0dc-4b16-a4b1-7e398b6bd0b5@example.com',
      metadata: { correlationId: id },
      idempotencyKey: 'receipt:7',
      correlationId: id,
      enqueuedAt: '2026-10-18T09:00:00.000Z',
      hash: '9b78657ef7fda7d4c7bff2c12a5030be81380dbf3c328b2db320a939fba92fa1',
    }),
  );
  assert.strictEqual(request.id, id);
  assert.strictEqual(request.unique, true);
});

test('Golden: a job without a key takes its identifiers from generateId', () => {
  let count = 0;
  const { data, request } = prepareJob(
    {
      kind: 'content',
      subject: 'Hi',
      content: { html: '<p>Hi</p>' },
      from: 'a@example.com',
      to: 'b@example.com',
    },
    { now: () => NOW, generateId: (kind) => `${kind}-${++count}` },
  );
  assert.strictEqual(data.idempotencyKey, 'idempotency-key-1');
  assert.strictEqual(data.messageId, 'message-id-2@example.com');
  assert.strictEqual(request.id, '679de35a-779d-4013-bf0d-1f97e6265891');
  assert.strictEqual(data.hash, '5b3ee612a4ec4bf7a261c8308d73eba825bc7fe9e83510da3bff3462661cc08f');
  assert.strictEqual(request.unique, false);
});

test('Golden: deriveId is given the seeds of 1.2', () => {
  const seeds = [];
  const { data, request } = prepareJob(
    {
      kind: 'content',
      subject: 'Hi',
      content: { text: 'Hi' },
      from: 'a@example.com',
      to: 'b@example.com',
      idempotencyKey: 'd:1',
    },
    {
      now: () => NOW,
      deriveId: (kind, seed) => {
        seeds.push(`${kind} ${seed.slice(0, 12)}`);
        return `${kind}.${seed.slice(0, 12)}`;
      },
    },
  );
  assert.strictEqual(request.id, 'job-id.7eaa5589f3e9');
  assert.strictEqual(data.messageId, 'message-id.477a68cc26e0@example.com');
  assert.strictEqual(data.hash, '34ab46f456ce0703eee5a27a214df7688bbfe2c4c5b919f5016ec14ca17c3e5a');
  // Each identifier is derived twice, to tell a generator given by mistake.
  assert.deepStrictEqual(seeds, [
    'job-id 7eaa5589f3e9',
    'job-id 7eaa5589f3e9',
    'message-id 477a68cc26e0',
    'message-id 477a68cc26e0',
  ]);
});

test('Golden: a sealed job keeps in clear the envelope of 1.2', async () => {
  const clock = manualClock(NOW);
  const driver = createMemoryQueue({ now: clock.now, sleep: clock.sleep });
  const queue = createQueue({
    driver,
    now: clock.now,
    codec: CODEC,
    signingKeys: SIGNING_KEYS,
    traceContext: () => '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
  });
  const answer = await queue.enqueue({
    kind: 'template',
    template: 'reset',
    context: { url: 'https://example.com/r/1' },
    from: 'Hirevel <no-reply@example.com>',
    to: 'ada@example.com',
    idempotencyKey: 'reset:1',
    tenantId: 'acme',
  });
  const { data } = driver.get(answer.id);
  assert.deepStrictEqual(Object.keys(data), [
    'v',
    'correlationId',
    'enqueuedAt',
    'hash',
    'kid',
    'mac',
    'trace',
    'enc',
  ]);
  assert.strictEqual(data.v, 1);
  assert.strictEqual(data.hash, '5aa3be5f41e3bf3c5ddb96de1e5a614540f8ec34d03b82fc072fbe9a18bf981e');
  assert.strictEqual(data.mac, 'e5966d1dfa46dc51f0d6065b9945a184cb8e8287184065b1312c1e4aded6b54d');
  assert.deepStrictEqual(Object.keys(JSON.parse(CODEC.decode(data.enc))), [
    'kind',
    'template',
    'context',
    'from',
    'to',
    'priority',
    'messageId',
    'metadata',
    'idempotencyKey',
    'tenantId',
  ]);
});

test('Golden: the audit events of a job sent, and of a delivery event', async (t) => {
  const clock = manualClock(NOW);
  const driver = createMemoryQueue({
    now: clock.now,
    sleep: clock.sleep,
    pollIntervalMilliseconds: 1000,
  });
  const audit = createMemoryAuditSink();
  const queue = createQueue({ driver, audit, now: clock.now });
  const renderer = createTemplateRenderer({
    engine: fakeEngine(),
    loader: createMemoryLoader({
      'reset.tpl': '---\nsubject: Reset your password\n---\n<p>Open {{url}}</p>',
    }),
  });
  const answer = await queue.enqueue({
    kind: 'template',
    template: 'reset',
    context: { url: 'https://example.com/r/1' },
    from: 'Hirevel <no-reply@example.com>',
    to: 'ada@example.com',
    idempotencyKey: 'reset:1',
    tenantId: 'acme',
  });
  assert.deepStrictEqual(answer, {
    id: 'e3787419-46b6-47a6-854d-fd2c5407eee6',
    correlationId: 'e3787419-46b6-47a6-854d-fd2c5407eee6',
    messageId: '64bd7756-b688-46ce-b760-2b61a05b3bf0@example.com',
    duplicate: false,
  });
  const transport = fakeTransport(() => sent('p-1'));
  const worker = queue.createWorker({ transport, renderer, random: () => 0 });
  t.after(() => worker.close());
  await driver.drain();
  assert.strictEqual(transport.calls[0].message.messageId, answer.messageId);
  const events = [];
  for (const event of audit.events) {
    events.push({ id: event.id, state: event.state, attempt: event.attempt });
  }
  assert.deepStrictEqual(events, [
    { id: '3953a904-ae10-4eb7-8e59-9d4cc8a654d8', state: 'queued', attempt: 0 },
    { id: 'b1194d8e-8488-429c-9c8b-e672f59e0f44', state: 'rendered', attempt: 1 },
    { id: '028ff379-174f-4a33-84e9-b2e623eeadc5', state: 'submitted', attempt: 1 },
    { id: '6de2bb6b-6396-495f-9729-78a8ed5353a2', state: 'accepted', attempt: 1 },
  ]);
  assert.strictEqual(
    audit.events[1].messageHash,
    '5897d492a2f32b2f95830a1133a6675bee20e8b75aa5d584145e00e29a037af5',
  );
  const delivered = auditEventOfDeliveryEvent({
    provider: 'ses',
    type: 'delivered',
    id: 'evt-1',
    correlationId: 'c-1',
    tags: [],
    metadata: {},
    raw: null,
  });
  assert.strictEqual(delivered.id, '0d1bffc0-d11f-4fd0-9ee0-1d3ac5b80a78');
});

test('Golden: the ranks of the states of 1.2, as a store of audit events holds them', () => {
  const ranks = {};
  for (const state of [
    'queued',
    'rendered',
    'submitted',
    'accepted',
    'delivery_unknown',
    'delivered',
    'failed',
    'bounced',
    'complained',
  ]) {
    ranks[state] = rankOf(state);
  }
  assert.deepStrictEqual(ranks, {
    queued: 0,
    rendered: 1,
    submitted: 2,
    accepted: 3,
    delivery_unknown: 3,
    delivered: 4,
    failed: 4,
    bounced: 5,
    complained: 6,
  });
});

test('Golden: ./idempotency reserves under the namespace and fingerprint of 1.2', async () => {
  const store = createMemoryIdempotencyStore();
  const reserved = [];
  const spy = {
    reserve: (key, fingerprint, ...rest) => {
      reserved.push([key, fingerprint]);
      return store.reserve(key, fingerprint, ...rest);
    },
    complete: (...args) => store.complete(...args),
    release: (...args) => store.release(...args),
  };
  const transport = new IdempotencyTransport(
    fakeTransport(() => sent('x')),
    { store: spy },
  );
  await transport.send(createMessage({ ...email(), idempotencyKey: 'otp:1', tenantId: 'acme' }));
  assert.deepStrictEqual(reserved, [['fake:otp:1', EMAIL_FINGERPRINT]]);
});

test('Golden: a job 1.2 wrote is sent with its Message-ID and Content-IDs', async () => {
  const transport = fakeTransport(() => sent('p-1'));
  const handler = createJobHandler({
    transport,
    signingKeys: SIGNING_KEYS,
    now: () => NOW,
    random: () => 0,
  });
  const outcome = await handler(runOf(JOB_V1), new AbortController().signal);
  assert.strictEqual(outcome.type, 'ack');
  const { message } = transport.calls[0];
  assert.strictEqual(message.messageId, 'c0560d27-3646-43f5-a9fe-9f7a4ff360ee@example.com');
  const contentIds = [];
  for (const attachment of message.attachments) contentIds.push(attachment.contentId);
  assert.deepStrictEqual(contentIds, [
    '99a96837-35b9-441c-a3a2-7cf939b32dc6@example.com',
    '11a6be93-bc92-4e04-9cbd-bea79ab229a0@example.com',
  ]);
  assert.deepStrictEqual(message.recipients, [
    { address: 'ada@example.com' },
    { name: 'Grace', address: 'grace@example.org' },
  ]);
  assert.strictEqual(message.subject, 'Your receipt');
  assert.strictEqual(message.metadata.correlationId, JOB_V1.request.id);
});

test('Golden: a sealed job 1.2 wrote is opened and sent as it was', async () => {
  const transport = fakeTransport(() => sent('p-1'));
  const handler = createJobHandler({
    transport,
    signingKeys: SIGNING_KEYS,
    codec: CODEC,
    now: () => NOW,
    random: () => 0,
  });
  const outcome = await handler(runOf(SEALED_JOB_V1), new AbortController().signal);
  assert.strictEqual(outcome.type, 'ack');
  assert.strictEqual(
    transport.calls[0].message.messageId,
    'c0560d27-3646-43f5-a9fe-9f7a4ff360ee@example.com',
  );
});

test('Golden: the message of a job 1.2 wrote, enqueued again under its key, is its duplicate', async () => {
  const clock = manualClock(NOW);
  const driver = createMemoryQueue({ now: clock.now, sleep: clock.sleep });
  await driver.enqueue({ ...JOB_V1.request, data: structuredClone(JOB_V1.data) });
  const queue = createQueue({ driver, now: clock.now, signingKeys: SIGNING_KEYS });
  const answer = await queue.enqueue(receiptJob());
  assert.deepStrictEqual(answer, {
    id: JOB_V1.request.id,
    correlationId: JOB_V1.request.id,
    messageId: JOB_V1.data.messageId,
    duplicate: true,
  });
});
