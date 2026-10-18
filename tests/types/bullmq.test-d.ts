import { expectAssignable, expectError, expectType } from 'tsd';
import { Queue, Worker } from 'bullmq';
import type { QueueDriver } from '../../index.js';
import { createMailQueue } from '../../src/queue/index.js';
import {
  MAILER_BACKOFF_TYPE,
  createBullMQBackoffStrategy,
  createBullMQDriver,
  createBullMQProcessor,
  type BullMQDriver,
  type BullMQProcessor,
} from '../../src/bullmq/index.js';

// The real classes of bullmq fit the structural types, and come back typed.
const driver = createBullMQDriver<Queue, Worker>({
  bullmq: { Queue, Worker },
  connection: { host: 'localhost', port: 6379 },
  prefix: 'app',
  jobOptions: { removeOnComplete: { age: 3600 } },
  workerOptions: { lockDuration: 60_000, limiter: { max: 10, duration: 1000 } },
  priorities: { high: 1 },
  detectDuplicates: 'bulk',
});
expectType<BullMQDriver<Queue, Worker>>(driver);
expectAssignable<QueueDriver>(driver);
expectType<Queue>(driver.queue);
const consumer = driver.consume(async () => ({ type: 'ack' }), { concurrency: 2 });
expectType<Worker>(consumer.worker);
declare const own: Queue;
createBullMQDriver({ bullmq: { Queue: own } });
expectError(createBullMQDriver({ bullmq: { Queue }, jobOptions: { attempts: 3 } }));
expectError(createBullMQDriver({ bullmq: { Queue }, workerOptions: { concurrency: 3 } }));
createMailQueue({ driver });

// A Worker of your own, with the processor and the strategy.
const processor: BullMQProcessor = createBullMQProcessor(async () => ({ type: 'ack' }), {
  rateLimit: (ms) => own.rateLimit(ms),
});
new Worker('mail', processor, {
  connection: { host: 'localhost' },
  settings: { backoffStrategy: createBullMQBackoffStrategy() },
});
expectType<'alexify-mailer'>(MAILER_BACKOFF_TYPE);
