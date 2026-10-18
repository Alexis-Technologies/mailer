// Not ported: the types of ./bullmq, after the structural types of
// @alexify/migronaut's ./bullmq: BullMQ is not a dependency of any kind, its
// classes are passed in, and these name only the members the driver calls.
// Methods use shorthand, compared bivariantly, so that BullMQ's generic and
// overloaded signatures satisfy them without being imported.

import type { Logger, QueueConsumer, QueueDriver, QueueHandler } from '../../index.js';

/** The members of a BullMQ `Job` the processor reads and calls. */
export interface BullMQJobLike {
  id?: string;
  name: string;
  data: any;
  timestamp: number;
  opts: { attempts?: number };
  attemptsMade: number;
  stalledCounter?: number;
  moveToDelayed?(timestamp: number, token?: string): Promise<unknown>;
  moveToWait?(token?: string): Promise<unknown>;
  updateData?(data: any): Promise<unknown>;
}

/** The members of a BullMQ `Queue` the driver calls. */
export interface BullMQQueueLike {
  name: string;
  add(name: string, data: any, opts?: any): Promise<unknown>;
  addBulk(jobs: { name: string; data: any; opts?: any }[]): Promise<unknown>;
  getJob(id: string): Promise<{ data: any; timestamp: number } | undefined | null>;
  rateLimit?(expireTimeMs: number): Promise<unknown>;
  close(): Promise<void>;
}

/** The members of a BullMQ `Worker` the driver calls. */
export interface BullMQWorkerLike {
  name: string;
  close(force?: boolean): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): unknown;
  /** Deprecated in BullMQ, on the queue since; used when the queue has none. */
  rateLimit?(expireTimeMs: number): Promise<unknown>;
  /** BullMQ ≥ 5.7x: aborts the signals of the jobs in flight. */
  cancelAllJobs?(reason?: string): void;
}

/** The `Queue` class: `new Queue(name, { connection, prefix })`. */
export type BullMQQueueClass<Q extends BullMQQueueLike = BullMQQueueLike> = new (
  name: string,
  opts: any,
) => Q;

/** The `Worker` class: `new Worker(name, processor, { connection, concurrency, … })`. */
export type BullMQWorkerClass<W extends BullMQWorkerLike = BullMQWorkerLike> = new (
  name: string,
  processor: any,
  opts: any,
) => W;

/** A backoff strategy of a BullMQ worker. */
export type BullMQBackoffStrategy = (
  attemptsMade: number,
  type?: string,
  err?: Error,
  job?: any,
) => number | Promise<number>;

/** The backoff type of mail jobs, which the strategy of the driver reads. */
export declare const MAILER_BACKOFF_TYPE: 'alexify-mailer';

/** The options of the jobs the driver adds; it sets the others itself. */
export interface BullMQMailJobOptions {
  /** @default { age: 86400 }: by time, so that the window of duplicates does not shrink under load. */
  removeOnComplete?: boolean | number | { age?: number; count?: number };
  /** @default { age: 604800 } */
  removeOnFail?: boolean | number | { age?: number; count?: number };
  keepLogs?: number;
  stackTraceLimit?: number;
  sizeLimit?: number;
  attempts?: never;
  backoff?: never;
  jobId?: never;
  priority?: never;
  delay?: never;
  deduplication?: never;
  repeat?: never;
  parent?: never;
  lifo?: never;
  timestamp?: never;
  [option: string]: unknown;
}

/** The options of the workers the driver makes. */
export interface BullMQMailWorkerOptions {
  lockDuration?: number;
  maxStalledCount?: number;
  stalledInterval?: number;
  /** Needed for a retry of the whole queue on a rate limit (`rateLimitScope: 'queue'`). */
  limiter?: { max: number; duration: number };
  settings?: { backoffStrategy?: BullMQBackoffStrategy; [setting: string]: unknown };
  connection?: never;
  prefix?: never;
  concurrency?: never;
  autorun?: never;
  [option: string]: unknown;
}

/** The options of {@link createBullMQDriver}. */
export interface BullMQDriverOptions<Q extends BullMQQueueLike, W extends BullMQWorkerLike> {
  /**
   * The classes of your install of bullmq; or a `Queue` of your own, which the
   * driver does not close, and without `Worker` only to enqueue.
   */
  readonly bullmq: {
    readonly Queue: BullMQQueueClass<Q> | Q;
    readonly Worker?: BullMQWorkerClass<W>;
  };
  readonly connection?: unknown;
  /** @default 'mail', or the name of the queue given */
  readonly queueName?: string;
  readonly prefix?: string;
  readonly jobOptions?: BullMQMailJobOptions;
  readonly workerOptions?: BullMQMailWorkerOptions;
  /** BullMQ's priorities, from 1, as 0 runs before them all. @default { high: 1, normal: 2, low: 3 } */
  readonly priorities?: { readonly high?: number; readonly normal?: number; readonly low?: number };
  /**
   * Whether an enqueue reads back a job of its key to tell a duplicate; with
   * `'bulk'`, `enqueueMany` too. @default true
   */
  readonly detectDuplicates?: boolean | 'bulk';
  /** The finished jobs whose data is kept: the others keep their version and hash. @default 'failed' */
  readonly retainData?: 'all' | 'failed' | 'none';
  /** Hears the events of the workers: errors, jobs BullMQ failed itself, stalls. */
  readonly logger?: Logger;
}

/** A processor of BullMQ. */
export interface BullMQProcessor {
  (job: BullMQJobLike, token?: string, signal?: AbortSignal): Promise<unknown>;
  /** Aborts the jobs it runs: one not yet sent goes back to the queue. */
  shutdown(reason?: unknown): void;
}

/** The options of {@link createBullMQProcessor}. */
export interface BullMQProcessorOptions {
  /** The queue's rateLimit, for a retry of the whole queue; the worker needs its `limiter`. */
  readonly rateLimit?: (milliseconds: number) => Promise<unknown>;
  readonly signal?: AbortSignal;
  /** The finished jobs whose data is kept, through `job.updateData`. @default 'failed' */
  readonly retainData?: 'all' | 'failed' | 'none';
}

/** A consumer of a BullMQ driver: its worker. */
export interface BullMQConsumer<
  W extends BullMQWorkerLike = BullMQWorkerLike,
> extends QueueConsumer {
  readonly worker: W;
}

/** A queue driver over BullMQ. */
export interface BullMQDriver<
  Q extends BullMQQueueLike = BullMQQueueLike,
  W extends BullMQWorkerLike = BullMQWorkerLike,
> extends QueueDriver {
  readonly id: 'bullmq';
  readonly queue: Q;
  consume(
    handler: QueueHandler,
    options?: { readonly concurrency?: number; readonly signal?: AbortSignal },
  ): BullMQConsumer<W>;
  /** A processor of the handler, for a Worker of your own (with `createBullMQBackoffStrategy()`). */
  createProcessor(handler: QueueHandler, options?: BullMQProcessorOptions): BullMQProcessor;
  /** Closes the queue it made. */
  close(): Promise<void>;
}

/**
 * Makes a queue driver over BullMQ.
 *
 * @example
 * ```js
 * const { Queue, Worker } = require('bullmq');
 * const driver = createBullMQDriver({ bullmq: { Queue, Worker }, connection: { host: 'localhost' } });
 * const queue = createMailQueue({ driver });
 * ```
 * @throws {TypeError} If an option is invalid.
 */
export declare function createBullMQDriver<
  Q extends BullMQQueueLike = BullMQQueueLike,
  W extends BullMQWorkerLike = BullMQWorkerLike,
>(options: BullMQDriverOptions<Q, W>): BullMQDriver<Q, W>;

/**
 * Makes a BullMQ processor of a queue handler, for a `Worker` of your own,
 * which needs `settings: { backoffStrategy: createBullMQBackoffStrategy() }`.
 *
 * @throws {TypeError} If the handler is not a function.
 */
export declare function createBullMQProcessor(
  handler: QueueHandler,
  options?: BullMQProcessorOptions,
): BullMQProcessor;

/**
 * Makes the backoff strategy of a worker of mail jobs: the delay the queue
 * chose, and `fallback` for jobs of other custom types.
 *
 * @throws {TypeError} If `fallback` is not a function.
 */
export declare function createBullMQBackoffStrategy(
  fallback?: BullMQBackoffStrategy,
): BullMQBackoffStrategy;
