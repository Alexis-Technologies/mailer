// Not ported: the types of ./queue, messages sent through a queue.

/// <reference lib="esnext.disposable" />

import type {
  Address,
  AuditSink,
  CalendarMethod,
  IdGenerator,
  JsonObject,
  ListFields,
  Logger,
  MessageContent,
  MessageTracking,
  Priority,
  QueueDriver,
  QueueEnqueueOptions,
  QueueHandler,
  QueueJob,
  QueueJobRequest,
  QueueCloseOptions,
  QueueSource,
  Receipt,
  Transport,
} from '../../index.js';
import type { Renderer } from '../render/index.js';

/** The version of the data of a job this package writes and reads. */
export declare const MAIL_JOB_VERSION: 1;
/** The name of a mail job. */
export declare const MAIL_JOB_NAME: 'mail';

/** An attachment of a job: its bytes, kept in the job in base64, or a reference the worker resolves. */
export type MailJobAttachmentInput = {
  readonly filename: string;
  /** @default 'application/octet-stream' */
  readonly contentType?: string;
  readonly inline?: boolean;
  /** Made and fixed when the job is made, when absent. */
  readonly contentId?: string;
} & (
  | { readonly content: Uint8Array; readonly ref?: undefined }
  | { readonly ref: string; readonly content?: undefined }
);

/** The fields of the message of a job. */
export interface MailJobFieldsInput {
  readonly from: Address | string;
  readonly to: Address | string | readonly (Address | string)[];
  readonly cc?: Address | string | readonly (Address | string)[];
  readonly bcc?: Address | string | readonly (Address | string)[];
  readonly replyTo?: Address | string | readonly (Address | string)[];
  /** Over the subject of the template, when both give one. */
  readonly subject?: string;
  readonly attachments?: readonly MailJobAttachmentInput[];
  readonly priority?: Priority;
  readonly tags?: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly list?: ListFields;
  /**
   * The key the job is enqueued once under: an enqueue again with it is the
   * same job, and with it for another message is refused. Made when absent.
   * An id of what the message tells of (`reset:${request.id}`), never an
   * address or a secret: the id of the job is a hash of it.
   */
  readonly idempotencyKey?: string;
  readonly messageId?: string;
  readonly date?: Date;
  readonly inReplyTo?: string | readonly string[];
  readonly references?: string | readonly string[];
  readonly calendar?: { readonly method?: CalendarMethod; readonly content: string };
  /** Not sent before then: a delay of the queue, never passed to the provider. */
  readonly scheduledAt?: Date;
  /** Not sent after then: a code of sign-in sent late is of no use. */
  readonly expiresAt?: Date;
  readonly tracking?: MessageTracking;
  readonly metadata?: Readonly<Record<string, string>>;
  /** The keys of the job are scoped to it. */
  readonly tenantId?: string;
  /** What the events of the message share; by default its `metadata.correlationId`, or the id of the job. */
  readonly correlationId?: string;
  /** @default the queue's maxAttempts, 5 */
  readonly maxAttempts?: number;
}

/** A job that the worker renders from a template. */
export interface MailTemplateJobInput extends MailJobFieldsInput {
  readonly kind: 'template';
  readonly template: string;
  /** JSON only: a Date as an ISO string, no Map, no class. */
  readonly context?: JsonObject;
  readonly locale?: string;
}

/** A job of content rendered already. */
export interface MailContentJobInput extends MailJobFieldsInput {
  readonly kind: 'content';
  readonly subject: string;
  readonly content: MessageContent;
}

/** A message to send through the queue. */
export type MailJobInput = MailTemplateJobInput | MailContentJobInput;

/** An address as a job holds it. */
export interface MailJobAddress {
  readonly name?: string;
  readonly address: string;
}

/** An attachment as a job holds it: `data` in base64, or `ref`. */
export interface MailJobAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly inline: boolean;
  readonly contentId: string;
  readonly data?: string;
  readonly ref?: string;
}

interface MailJobDataBase {
  readonly v: 1;
  readonly from: MailJobAddress;
  readonly to: readonly MailJobAddress[];
  readonly cc?: readonly MailJobAddress[];
  readonly bcc?: readonly MailJobAddress[];
  readonly replyTo?: readonly MailJobAddress[];
  readonly subject?: string;
  readonly attachments?: readonly MailJobAttachment[];
  readonly priority: Priority;
  readonly tags?: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly list?: JsonObject;
  readonly idempotencyKey: string;
  /** Fixed when the job is made: every attempt sends this Message-ID. */
  readonly messageId: string;
  readonly date?: string;
  readonly inReplyTo?: readonly string[];
  readonly references?: readonly string[];
  readonly calendar?: { readonly method?: CalendarMethod; readonly content: string };
  readonly tracking?: MessageTracking;
  /** Always with `correlationId`, which webhooks give back. */
  readonly metadata: Readonly<Record<string, string>>;
  readonly tenantId?: string;
  readonly correlationId: string;
  readonly notBefore?: string;
  readonly expiresAt?: string;
  readonly enqueuedAt: string;
  /** The SHA-256 of the job, all but `enqueuedAt`, `mac`, `kid`, `trace` and itself. */
  readonly hash: string;
  /** The HMAC-SHA256 of the job under the key `kid`, when the queue signs its jobs. */
  readonly mac?: string;
  /** The id of the signing key of `mac`. */
  readonly kid?: string;
  /** The W3C `traceparent` of the producer, when the queue is given one. */
  readonly trace?: string;
}

/** The data of a template job, as stored. */
export interface MailTemplateJobData extends MailJobDataBase {
  readonly kind: 'template';
  readonly template: string;
  readonly context: JsonObject;
  readonly locale?: string;
}

/** The data of a content job, as stored. */
export interface MailContentJobData extends MailJobDataBase {
  readonly kind: 'content';
  readonly subject: string;
  readonly content: MessageContent;
}

/** The data of a mail job, as stored: JSON only. */
export type MailJobData = MailTemplateJobData | MailContentJobData;

/**
 * A key that signs jobs: an HMAC-SHA256 key of 32 bytes at least. Of the keys
 * given, the first signs and each verifies, so a key is rotated by putting
 * the new one first and dropping the old one once its jobs are done.
 */
export interface MailJobSigningKey {
  /** 1 to 64 of A-Z, a-z, 0-9, `.`, `_` and `-`; written into each job it signs as `kid`. */
  readonly id: string;
  readonly secret: string | Uint8Array;
}

/**
 * Seals the fields of a job in its store, such as an envelope encryption
 * under the application's key or KMS: `encode` gets their JSON and gives the
 * text stored as `enc`, `decode` gives the JSON back. The version, the hash,
 * the signature and the trace context stay in clear.
 */
export interface MailJobCodec {
  encode(text: string): string | Promise<string>;
  /** Throws an error with `retryable: false` when the text can never be opened, so the job fails rather than waits. */
  decode(text: string): string | Promise<string>;
}

/** The options of the jobs of a queue. */
export interface MailJobOptions {
  /** The scope of the keys of the jobs. @default 'mail' */
  readonly namespace?: string;
  /** @default 5 */
  readonly maxAttempts?: number;
  /** @default 262144 */
  readonly maxJobBytes?: number;
  /** The bytes of attachments a job holds; larger ones go as `{ ref }`. @default 262144 */
  readonly maxInlineAttachmentBytes?: number;
  readonly generateId?: IdGenerator;
  readonly now?: () => number;
  /** Signs each job (`kid`, `mac`) with the first key, for workers that read only signed jobs. */
  readonly signingKeys?: readonly MailJobSigningKey[];
  /**
   * The secret, 32 bytes at least, under which the id of a job is derived
   * from its key (an HMAC rather than a SHA-256), so that an id cannot be
   * traced back to a key that names a person. The same on every producer,
   * and never rotated: another secret makes other ids, and the same message
   * another job.
   */
  readonly idSecret?: string | Uint8Array;
}

/** A job of a message: its data, and the request a driver takes. */
export interface PreparedMailJob {
  readonly data: MailJobData;
  readonly request: QueueJobRequest;
}

/**
 * Makes the job of a message. Its fields are checked as `createMessage`
 * checks them, and its Message-ID, Content-IDs and id fixed.
 *
 * @throws {TypeError} If a field is invalid.
 * @throws {RangeError} If the job or its attachments are too large.
 */
export declare function prepareMailJob(
  input: MailJobInput,
  options?: MailJobOptions,
): PreparedMailJob;

/**
 * Checks the data of a job read from its queue, opened if it was sealed.
 *
 * @throws {MailQueueError} `queue.invalid_job`; `queue.codec_missing` for a
 * sealed job; `queue.unsupported_version`
 * for a later version, or a field this version does not know; or
 * `queue.hash_mismatch`; `queue.signature_invalid` if `signingKeys` are given
 * and the job is not signed by one of them.
 * @throws {TypeError} If a signing key is invalid.
 */
export declare function parseMailJob(
  data: unknown,
  options?: { readonly signingKeys?: readonly MailJobSigningKey[] },
): MailJobData;

/** The code of a {@link MailQueueError}. */
export type MailQueueErrorCode =
  | 'queue.key_reused'
  | 'queue.invalid_job'
  | 'queue.unsupported_version'
  | 'queue.hash_mismatch'
  | 'queue.signature_invalid'
  | 'queue.codec_missing'
  | 'queue.codec_failed';

/** A failure of the queue, by its code. */
export declare class MailQueueError extends Error {
  readonly code: MailQueueErrorCode;
  /** `queue.key_reused`: the jobs whose keys were used before for other messages. */
  readonly jobIds?: readonly string[];
  /** `queue.key_reused` of `enqueueMany`: what the other jobs of the call gave. */
  readonly answers?: readonly MailEnqueueResult[];
  constructor(code: MailQueueErrorCode, message: string, options?: ErrorOptions);
}

/** The input a worker gives its renderer for a template job. */
export interface MailRenderInput {
  readonly template: string;
  readonly context: JsonObject;
  readonly locale?: string;
  readonly tenantId?: string;
  /** Aborts when the worker stops the job: a renderer may stop with it. */
  readonly signal?: AbortSignal;
}

/** What `classify` may decide of a failed receipt. */
export type MailFailureDecision = 'retry' | 'fail' | 'delivery_unknown' | undefined;

/** The backoff between attempts. */
export interface MailBackoff {
  /** @default 30000 */
  readonly baseDelayMilliseconds?: number;
  /** @default 3600000 */
  readonly maxDelayMilliseconds?: number;
  /** @default 2 */
  readonly factor?: number;
}

/** The options of a worker, or of {@link createMailJobHandler}. */
export interface MailWorkerOptions {
  /**
   * The transport, decorated as the application chooses. Its own retries are
   * best few (`retries: 1`, no `RetryTransport`): the queue retries.
   */
  readonly transport: Transport;
  /** The renderer of template jobs, such as one of `./templates`. */
  readonly renderer?: Renderer<MailRenderInput>;
  /** The attachment, or its content, a reference names. Called again on each attempt. */
  readonly resolveAttachment?: (
    ref: string,
    context: {
      readonly job: MailJobData;
      readonly attachment: Omit<MailJobAttachment, 'data' | 'ref'>;
      readonly signal: AbortSignal;
    },
  ) => unknown;
  /** Refuses a job, for good, by throwing: a sender not allowed. */
  readonly checkJob?: (data: MailJobData, job: QueueJob) => void | Promise<void>;
  /** Decides of a failed receipt in the place of the rules. */
  readonly classify?: (failure: {
    readonly receipt: Receipt;
    readonly job: QueueJob;
  }) => MailFailureDecision;
  readonly audit?: AuditSink;
  /** A sink that fails before the send makes the job retried, rather than sent unrecorded. @default false */
  readonly auditStrict?: boolean;
  /**
   * Only jobs signed by one of these keys are sent; any other fails with
   * `queue.signature_invalid`. A worker of a queue takes the queue's.
   */
  readonly signingKeys?: readonly MailJobSigningKey[];
  /**
   * Opens sealed jobs. A sealed job this worker cannot open waits for one
   * that can (`queue.codec_missing`, `queue.codec_failed`). A worker of a
   * queue takes the queue's.
   */
  readonly codec?: MailJobCodec;
  readonly backoff?: MailBackoff;
  /** The wait before an attempt again after an `auth` or `configuration` failure. @default 300000 */
  readonly operatorDelayMilliseconds?: number;
  /** `queue`: a rate limit makes the whole queue wait, where the driver can. @default 'job' */
  readonly rateLimitScope?: 'job' | 'queue';
  /**
   * The runs of a job that may end unsettled (its worker killed, its event
   * loop blocked) before the job is given up as `delivery_unknown`
   * (`queue.redelivery_exhausted`), so that one job cannot kill every worker
   * in turn for ever. @default 3
   */
  readonly maxRedeliveries?: number;
  /**
   * What a run again of an attempt does, its run before having died:
   * `send` (for `IdempotencyTransport` or a provider's key to dedupe), or
   * `delivery_unknown`, which sends it only when the audit sink can tell
   * (`has`) that the run before died before it submitted. For a transport
   * with no idempotency key (SES, SMTP) without `IdempotencyTransport`.
   * @default 'send'
   */
  readonly redelivered?: 'send' | 'delivery_unknown';
  readonly logger?: Logger;
  readonly random?: () => number;
  readonly now?: () => number;
}

/**
 * Makes the handler of mail jobs, for any driver: render, attachments,
 * message, send, and what the queue does with the receipt.
 *
 * @throws {TypeError} If an option is invalid.
 */
export declare function createMailJobHandler(options: MailWorkerOptions): QueueHandler;

/** The options of {@link createMailQueue}. */
export interface MailQueueOptions extends Omit<MailJobOptions, 'now'> {
  readonly driver: QueueDriver;
  readonly audit?: AuditSink;
  /** A sink that fails makes the enqueue fail, and the job retried before its send. @default false */
  readonly auditStrict?: boolean;
  /** Seals the fields of each job in the store; its workers open them. */
  readonly codec?: MailJobCodec;
  readonly logger?: Logger;
  readonly now?: () => number;
}

/** What an enqueue gives. */
export interface MailEnqueueResult {
  /** The id of the job. */
  readonly id: string;
  readonly correlationId: string;
  readonly messageId: string;
  /** true: a job of this key was held already, and nothing was added. */
  readonly duplicate: boolean | undefined;
}

/** The options of a worker of a queue. */
export interface MailQueueWorkerOptions extends Omit<MailWorkerOptions, 'audit' | 'auditStrict'> {
  /** @default 1 */
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}

/** A worker of a queue. */
export interface MailWorker extends AsyncDisposable {
  /** Stops taking jobs and waits for those in flight, then aborts them. */
  close(options?: QueueCloseOptions): Promise<void>;
}

/** A queue of mail. */
export interface MailQueue<TDriver extends QueueDriver = QueueDriver> {
  readonly driver: TDriver;
  /**
   * @throws {TypeError} If a field is invalid.
   * @throws {MailQueueError} `queue.key_reused` if its key was used for another message.
   */
  enqueue(input: MailJobInput, options?: QueueEnqueueOptions): Promise<MailEnqueueResult>;
  enqueueMany(
    inputs: Iterable<MailJobInput>,
    options?: QueueEnqueueOptions,
  ): Promise<readonly MailEnqueueResult[]>;
  createWorker(options: MailQueueWorkerOptions): MailWorker;
}

/**
 * Makes a mail queue over a driver.
 *
 * @example
 * ```js
 * const queue = createMailQueue({ driver: createMemoryQueue(), audit });
 * await queue.enqueue({
 *   kind: 'template', template: 'reset-password', context: { url },
 *   from: 'app@example.com', to: user.email, idempotencyKey: `reset:${resetRequest.id}`,
 * });
 * const worker = queue.createWorker({ transport, renderer: templates });
 * ```
 * @throws {TypeError} If an option is invalid.
 */
export declare function createMailQueue<TDriver extends QueueDriver>(
  options: MailQueueOptions & { readonly driver: TDriver },
): MailQueue<TDriver>;

/** The options of {@link createPollingDriver}. */
export interface PollingDriverOptions {
  /** @default 1000 */
  readonly pollIntervalMilliseconds?: number;
  /** @default 60000 */
  readonly leaseMilliseconds?: number;
  /** The delay of a job whose handler threw, times its attempt. @default 1000 */
  readonly defaultRetryDelayMilliseconds?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly logger?: Logger;
}

/**
 * Makes a driver of a source that lends its jobs, such as a store's outbox:
 * lanes that reserve a job, keep its lease while it runs, and settle it.
 *
 * @throws {TypeError} If the source or an option is invalid.
 */
export declare function createPollingDriver(
  source: QueueSource,
  options?: PollingDriverOptions,
): QueueDriver;

/** The reason a job's signal aborts when its lease is lost. */
export declare class QueueLeaseLostError extends Error {
  constructor(jobId: string);
}

/** A job of the memory queue, as it holds it. */
export interface MemoryQueueJob {
  readonly id: string;
  readonly name: string;
  readonly state: 'waiting' | 'delayed' | 'active' | 'completed' | 'failed';
  readonly priority: Priority;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly availableAt: number;
  /** Absent once the job is done with, by `retainData`. */
  readonly data?: JsonObject;
  readonly failure?: { readonly code: string; readonly reason: string };
  readonly result?: JsonObject;
}

/** The options of {@link createMemoryQueue}. */
export interface MemoryQueueOptions extends PollingDriverOptions {
  /** @default 100000 */
  readonly maxJobs?: number;
  /** The most jobs finished it keeps, the oldest dropped first. @default 10000 */
  readonly retainFinished?: number;
  /** The time a completed job is kept, and so the window of its duplicates. @default 86400 */
  readonly dedupeWindowSeconds?: number;
  /** The time a failed job is kept. @default 604800 */
  readonly retainFailedSeconds?: number;
  /** See {@link MailQueueRetainData}. @default 'failed' */
  readonly retainData?: MailQueueRetainData;
}

/**
 * The finished jobs whose data, the message with its addresses and context,
 * a store keeps: `'failed'` those that failed, for a retry by hand; `'all'`;
 * or `'none'`. A job's version and hash stay, by which a duplicate is told.
 */
export type MailQueueRetainData = 'all' | 'failed' | 'none';

/** The queue in memory. */
export interface MemoryQueue extends QueueDriver {
  /** The source the polling driver reads: what a store's outbox implements, in memory. */
  readonly source: QueueSource;
  list(): readonly MemoryQueueJob[];
  get(id: string): MemoryQueueJob | undefined;
  /** Settles when no job is ready now and none runs. */
  drain(): Promise<void>;
  /** Wakes its readers, after a clock of the tests moved. */
  wake(): void;
}

/**
 * Makes a queue in memory, for tests and a single process.
 *
 * @throws {TypeError} If an option is invalid.
 */
export declare function createMemoryQueue(options?: MemoryQueueOptions): MemoryQueue;
