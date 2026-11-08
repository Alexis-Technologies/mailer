import { expectAssignable, expectError, expectType } from 'tsd';
import type {
  QueueDriver,
  QueueHandler,
  QueueJob,
  QueueOutcome,
  QueueSource,
  Transport,
} from '../../index.js';
import { createMemoryAuditSink } from '../../src/audit/index.js';
import {
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
expectType<EnqueueResult>(result);
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
  resolveAttachment: async (ref, { job, attachment, signal }) => {
    expectType<JobData>(job);
    expectType<string>(attachment.filename);
    expectType<AbortSignal>(signal);
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
expectType<JobData>(prepared.data);
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
