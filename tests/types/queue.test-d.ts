import { expectAssignable, expectError, expectType } from 'tsd';
import type {
  AnyMessage,
  QueueDriver,
  QueueHandler,
  QueueJob,
  QueueOutcome,
  QueueSource,
  SmsMessage,
  Transport,
} from '../../index.js';
import { createMemoryAuditSink } from '../../src/audit/index.js';
import {
  CHANNEL_JOB_VERSION,
  EMAIL_JOB_NAME,
  EMAIL_JOB_VERSION,
  QueueError,
  QueueLeaseLostError,
  createJobHandler,
  createQueue,
  createMemoryQueue,
  createPollingDriver,
  parseJob,
  prepareJob,
  type ChannelEnqueueResult,
  type ChannelJobData,
  type ChannelJobInput,
  type EmailEnqueueResult,
  type EmailJobData,
  type EnqueueResult,
  type JobData,
  type MessageQueue,
  type QueueWorker,
  type MemoryQueue,
  type MemoryQueueJob,
} from '../../src/queue/index.js';
import { createTemplateRenderer, type TemplateEngine } from '../../src/templates/index.js';

declare const transport: Transport;
declare const engine: TemplateEngine;
const driver = createMemoryQueue({ maxJobs: 10, pollIntervalMilliseconds: 100 });
expectType<MemoryQueue>(driver);
expectType<QueueSource>(driver.source);
createMemoryQueue({ retainData: 'none', fairness: 'tenant' });
expectType<Promise<void>>(driver.resume({ tenantId: 'acme' }));
expectType<number>(driver.stats().ready);
expectType<boolean>(driver.retryFailed('j'));
expectType<readonly MemoryQueueJob[]>(driver.failed({ limit: 10 }));
expectError(createMemoryQueue({ fairness: 'fifo' }));
expectError(createMemoryQueue({ retainData: 'some' }));
expectAssignable<QueueDriver>(driver);
const queue = createQueue({
  driver,
  audit: createMemoryAuditSink(),
  namespace: 'mail',
  maxAttempts: 3,
});
expectType<MessageQueue<MemoryQueue>>(queue);
const result = await queue.enqueue({
  kind: 'template',
  template: 'reset',
  context: { url: 'https://example.com', n: 1, nested: { ok: true } },
  from: 'app@example.com',
  to: ['a@example.com', { name: 'B', address: 'b@example.com' }],
  idempotencyKey: 'reset:1',
  attachments: [
    { filename: 'a.txt', content: new Uint8Array() },
    { filename: 'b.pdf', ref: 's3://b' },
  ],
  scheduledAt: new Date(),
  priority: 'high',
});
expectType<EmailEnqueueResult>(result);
expectType<string>(result.messageId);
expectType<boolean | undefined>(result.duplicate);
await queue.enqueue({
  kind: 'content',
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 's',
  content: { text: 't' },
});
expectError(
  queue.enqueue({
    kind: 'content',
    from: 'a@example.com',
    to: 'b@example.com',
    content: { text: 't' },
  }),
);
expectError(
  queue.enqueue({
    kind: 'template',
    template: 'x',
    from: 'a',
    to: 'b',
    context: { when: new Date() },
  }),
);
expectError(
  queue.enqueue({
    kind: 'template',
    template: 'x',
    from: 'a',
    to: 'b',
    attachments: [{ filename: 'x' }],
  }),
);
const renderer = createTemplateRenderer({ engine, loader: { load: () => undefined } });
const worker = queue.createWorker({
  transport,
  renderer,
  concurrency: 4,
  resolveAttachment: async (ref, { job, attachment, medium, signal }) => {
    expectType<JobData>(job);
    expectType<AbortSignal>(signal);
    // An email job is told its attachment, a job of a channel its medium.
    if (attachment !== undefined) expectType<string>(attachment.filename);
    if (medium !== undefined) expectType<string>(medium.contentType);
    if (job.v === 2) return { url: `https://cdn.example.com/${ref}` };
    return new Uint8Array();
  },
  classify: ({ receipt, job }) => (receipt.successful || job.attempt > 1 ? 'fail' : undefined),
  backoff: { baseDelayMilliseconds: 1000 },
  rateLimitScope: 'queue',
});
expectType<QueueWorker>(worker);
await worker.close({ timeoutMilliseconds: 1000 });
await worker[Symbol.asyncDispose]();
expectError(queue.createWorker({ renderer }));

const handler: QueueHandler = createJobHandler({ transport });
declare const job: QueueJob;
expectType<Promise<QueueOutcome>>(handler(job, new AbortController().signal));
const prepared = prepareJob({
  kind: 'content',
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 's',
  content: { html: '<p/>' },
});
expectType<EmailJobData>(prepared.data);
expectType<string>(prepared.request.id);
expectType<JobData>(parseJob({}));
const keys = [
  { id: 'k1', secret: 'a'.repeat(32) },
  { id: 'k0', secret: new Uint8Array(32) },
];
expectType<JobData>(parseJob({}, { signingKeys: keys }));
expectType<string | undefined>(
  prepareJob(
    {
      kind: 'content',
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 's',
      content: { text: 't' },
    },
    { signingKeys: keys },
  ).data.mac,
);
createQueue({ driver, signingKeys: keys, idSecret: 's'.repeat(32) });
prepareJob(
  {
    kind: 'content',
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 's',
    content: { text: 't' },
  },
  { idSecret: new Uint8Array(32) },
);
expectError(createQueue({ driver, idSecret: 42 }));
createQueue({
  driver,
  deriveId: (kind, seed) => (kind === 'job-id' ? `job_${seed.slice(0, 26)}` : seed.slice(0, 32)),
});
expectError(createQueue({ driver, deriveId: (kind: number) => String(kind) }));
const codec = { encode: (text: string) => text, decode: async (text: string) => text };
createQueue({ driver, codec });
createJobHandler({ transport, codec, maxRedeliveries: 0, redelivered: 'delivery_unknown' });
expectError(createJobHandler({ transport, redelivered: 'never' }));
expectError(createQueue({ driver, codec: { encode: (text: string) => text } }));
createJobHandler({ transport, signingKeys: keys });
expectError(createJobHandler({ transport, signingKeys: [{ id: 'k', secret: 1 }] }));
expectType<1>(EMAIL_JOB_VERSION);
expectType<2>(CHANNEL_JOB_VERSION);
expectType<'mail'>(EMAIL_JOB_NAME);
const error = new QueueError('queue.key_reused', 'x');
expectType<
  | 'queue.key_reused'
  | 'queue.invalid_job'
  | 'queue.unsupported_version'
  | 'queue.hash_mismatch'
  | 'queue.signature_invalid'
  | 'queue.codec_missing'
  | 'queue.codec_failed'
>(error.code);
expectError(new QueueError('nope', 'x'));
new QueueLeaseLostError('j');
declare const source: QueueSource;
expectAssignable<QueueDriver>(createPollingDriver(source, { leaseMilliseconds: 1000 }));

// A job of a channel: the fields of its message, its media kept or resolved,
// its text rendered from a template; a mixed queue's results by kind.
const sms = await queue.enqueue({
  channel: 'sms',
  kind: 'content',
  to: '067 123 45 67',
  text: 'Your code is 1234',
  priority: 'high',
  idempotencyKey: 'otp:1',
  expiresAt: new Date(),
});
expectType<ChannelEnqueueResult<'sms'>>(sms);
expectType<'sms'>(sms.channel);
expectError(sms.messageId);
await queue.enqueue({
  channel: 'push',
  kind: 'template',
  template: 'shipped',
  context: { order: 'A-1' },
  to: { token: 'device' },
  media: [
    { url: 'https://example.com/a.png' },
    { content: new Uint8Array(), contentType: 'image/png' },
    { ref: 's3://b', contentType: 'image/jpeg', filename: 'b.jpg' },
  ],
  data: { order: 'A-1' },
});
await queue.enqueue({
  channel: 'whatsapp',
  kind: 'content',
  to: '+380671234567',
  providerTemplate: { name: 'otp', language: 'uk' },
});
// The template of a job is the renderer's; that of WhatsApp is providerTemplate.
expectError(
  queue.enqueue({
    channel: 'whatsapp',
    kind: 'content',
    to: '+380671234567',
    template: { name: 'otp', language: 'uk' },
  }),
);
expectError(
  queue.enqueue({
    channel: 'sms',
    kind: 'content',
    to: '+1',
    providerTemplate: { name: 'x', language: 'en' },
  }),
);
// A template job renders its text; a medium of a job holds bytes or a ref.
expectError(
  queue.enqueue({ channel: 'sms', kind: 'template', template: 't', to: '+1', text: 'x' }),
);
expectError(
  queue.enqueue({
    channel: 'sms',
    kind: 'content',
    to: '+1',
    media: [{ content: new Blob(), contentType: 'image/png' }],
  }),
);
expectError(queue.enqueue({ channel: 'sms', kind: 'content', to: '+1', subject: 's' }));
const mixed = await queue.enqueueMany([
  {
    kind: 'content',
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 's',
    content: { text: 't' },
  },
  { channel: 'telegram', kind: 'content', to: 42, text: 'hi' },
]);
expectType<readonly EnqueueResult[]>(mixed);
expectAssignable<ChannelJobInput<'telegram'>>({
  channel: 'telegram',
  kind: 'content',
  to: 42,
  text: 'x',
});
const channelJob = prepareJob(
  { channel: 'telegram', kind: 'content', to: '@news', text: 'hi' },
  { defaultCountry: 'UA' },
);
expectType<ChannelJobData>(channelJob.data);
expectType<2>(channelJob.data.v);
declare const router: Transport<'router', AnyMessage>;
declare const sender: Transport<'twilio', SmsMessage>;
createJobHandler({ transport: router });
createJobHandler({ transport: sender });
createQueue({ driver, defaultCountry: 'UA' });
