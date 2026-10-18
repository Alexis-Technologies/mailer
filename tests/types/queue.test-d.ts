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
  MAIL_JOB_NAME,
  MAIL_JOB_VERSION,
  MailQueueError,
  QueueLeaseLostError,
  createMailJobHandler,
  createMailQueue,
  createMemoryQueue,
  createPollingDriver,
  parseMailJob,
  prepareMailJob,
  type MailEnqueueResult,
  type MailJobData,
  type MailQueue,
  type MailWorker,
  type MemoryQueue,
} from '../../src/queue/index.js';
import { createTemplateRenderer, type TemplateEngine } from '../../src/templates/index.js';

declare const transport: Transport;
declare const engine: TemplateEngine;
const driver = createMemoryQueue({ maxJobs: 10, pollIntervalMilliseconds: 100 });
expectType<MemoryQueue>(driver);
expectType<QueueSource>(driver.source);
createMemoryQueue({ retainData: 'none', fairness: 'tenant' });
expectType<Promise<void>>(driver.resume({ tenantId: 'acme' }));
expectError(createMemoryQueue({ fairness: 'fifo' }));
expectError(createMemoryQueue({ retainData: 'some' }));
expectAssignable<QueueDriver>(driver);
const queue = createMailQueue({
  driver,
  audit: createMemoryAuditSink(),
  namespace: 'mail',
  maxAttempts: 3,
});
expectType<MailQueue<MemoryQueue>>(queue);
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
expectType<MailEnqueueResult>(result);
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
    expectType<MailJobData>(job);
    expectType<string>(attachment.filename);
    expectType<AbortSignal>(signal);
    return new Uint8Array();
  },
  classify: ({ receipt, job }) => (receipt.successful || job.attempt > 1 ? 'fail' : undefined),
  backoff: { baseDelayMilliseconds: 1000 },
  rateLimitScope: 'queue',
});
expectType<MailWorker>(worker);
await worker.close({ timeoutMilliseconds: 1000 });
await worker[Symbol.asyncDispose]();
expectError(queue.createWorker({ renderer }));

const handler: QueueHandler = createMailJobHandler({ transport });
declare const job: QueueJob;
expectType<Promise<QueueOutcome>>(handler(job, new AbortController().signal));
const prepared = prepareMailJob({
  kind: 'content',
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 's',
  content: { html: '<p/>' },
});
expectType<MailJobData>(prepared.data);
expectType<string>(prepared.request.id);
expectType<MailJobData>(parseMailJob({}));
const keys = [
  { id: 'k1', secret: 'a'.repeat(32) },
  { id: 'k0', secret: new Uint8Array(32) },
];
expectType<MailJobData>(parseMailJob({}, { signingKeys: keys }));
expectType<string | undefined>(
  prepareMailJob(
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
createMailQueue({ driver, signingKeys: keys, idSecret: 's'.repeat(32) });
prepareMailJob(
  {
    kind: 'content',
    from: 'a@example.com',
    to: 'b@example.com',
    subject: 's',
    content: { text: 't' },
  },
  { idSecret: new Uint8Array(32) },
);
expectError(createMailQueue({ driver, idSecret: 42 }));
const codec = { encode: (text: string) => text, decode: async (text: string) => text };
createMailQueue({ driver, codec });
createMailJobHandler({ transport, codec, maxRedeliveries: 0, redelivered: 'delivery_unknown' });
expectError(createMailJobHandler({ transport, redelivered: 'never' }));
expectError(createMailQueue({ driver, codec: { encode: (text: string) => text } }));
createMailJobHandler({ transport, signingKeys: keys });
expectError(createMailJobHandler({ transport, signingKeys: [{ id: 'k', secret: 1 }] }));
expectType<1>(MAIL_JOB_VERSION);
expectType<'mail'>(MAIL_JOB_NAME);
const error = new MailQueueError('queue.key_reused', 'x');
expectType<
  | 'queue.key_reused'
  | 'queue.invalid_job'
  | 'queue.unsupported_version'
  | 'queue.hash_mismatch'
  | 'queue.signature_invalid'
  | 'queue.codec_missing'
  | 'queue.codec_failed'
>(error.code);
expectError(new MailQueueError('nope', 'x'));
new QueueLeaseLostError('j');
declare const source: QueueSource;
expectAssignable<QueueDriver>(createPollingDriver(source, { leaseMilliseconds: 1000 }));
