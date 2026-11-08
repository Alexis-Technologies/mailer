// Not ported: the types of ./queue, messages sent through a queue.

/// <reference lib="esnext.disposable" />

import type {
  Address,
  AnyMessage,
  AuditSink,
  CalendarMethod,
  Channel,
  ChannelButton,
  ChannelMentions,
  ChannelMessage,
  IdGenerator,
  JsonObject,
  ListFields,
  Logger,
  MessageContent,
  MessageTracking,
  Priority,
  ProviderTemplate,
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
import type { ChannelMessageConstructors } from '../channels/index.js';
import type { Renderer } from '../render/index.js';

/** The version of the data of an email job, that of 1.x. */
export declare const EMAIL_JOB_VERSION: 1;
/** The version of the data of a job of a channel other than email. */
export declare const CHANNEL_JOB_VERSION: 2;
/** The name of an email job, as in 1.x; a job of another channel is named by its channel. */
export declare const EMAIL_JOB_NAME: 'mail';

/** An attachment of a job: its bytes, kept in the job in base64, or a reference the worker resolves. */
export type JobAttachmentInput = {
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

/** The fields of the message of an email job. */
export interface EmailJobFieldsInput {
  /** An email, as without it. */
  readonly channel?: 'email';
  readonly from: Address | string;
  readonly to: Address | string | readonly (Address | string)[];
  readonly cc?: Address | string | readonly (Address | string)[];
  readonly bcc?: Address | string | readonly (Address | string)[];
  readonly replyTo?: Address | string | readonly (Address | string)[];
  /** Over the subject of the template, when both give one. */
  readonly subject?: string;
  readonly attachments?: readonly JobAttachmentInput[];
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
export interface EmailTemplateJobInput extends EmailJobFieldsInput {
  readonly kind: 'template';
  readonly template: string;
  /** JSON only: a Date as an ISO string, no Map, no class. */
  readonly context?: JsonObject;
  readonly locale?: string;
}

/** A job of content rendered already. */
export interface EmailContentJobInput extends EmailJobFieldsInput {
  readonly kind: 'content';
  readonly subject: string;
  readonly content: MessageContent;
}

/** An email to send through the queue. */
export type EmailJobInput = EmailTemplateJobInput | EmailContentJobInput;

/** The channels other than email. */
type OtherChannel = Exclude<Channel, 'email'>;

/** A medium of a job: a URL or an id, its bytes kept in the job in base64, or a reference the worker resolves. */
export type JobMediumInput = {
  readonly filename?: string;
  readonly caption?: string;
} & (
  | { readonly url: string; readonly contentType?: `${string}/${string}` }
  | { readonly id: string; readonly contentType?: `${string}/${string}` }
  | { readonly content: Uint8Array; readonly contentType: `${string}/${string}` }
  | { readonly ref: string; readonly contentType: `${string}/${string}` }
);

/** What a job of a channel takes beside the fields of its message. */
interface ChannelJobFieldsInput {
  readonly media?: readonly JobMediumInput[];
  /** See {@link EmailJobFieldsInput.idempotencyKey}: an SMS and an email under one key are two jobs. */
  readonly idempotencyKey?: string;
  /** Not sent before then: a delay of the queue, never passed to the provider. */
  readonly scheduledAt?: Date;
  /** Not sent after then; passed on, as a provider may drop the message then (the TTL of a push). */
  readonly expiresAt?: Date;
  readonly tenantId?: string;
  readonly correlationId?: string;
  /** @default the queue's maxAttempts, 5 */
  readonly maxAttempts?: number;
}

/**
 * The fields of the message of a job of a channel, as `createChannelMessage`
 * takes them: the template WhatsApp approved is `providerTemplate`, as
 * `template` names a template of the renderer.
 */
type ChannelJobMessageInput<C extends OtherChannel> = Omit<
  ChannelMessageConstructors[C],
  'media' | 'template' | 'idempotencyKey' | 'scheduledAt' | 'expiresAt' | 'tenantId'
> &
  ChannelJobFieldsInput &
  (C extends 'whatsapp' ? { readonly providerTemplate?: ProviderTemplate } : unknown);

/**
 * A job of a channel whose text the worker renders from a template: the
 * text of the template, or of its HTML when it gives none; its subject is
 * the title of a push that has none.
 */
export type ChannelTemplateJobInput<C extends OtherChannel = OtherChannel> = {
  [K in C]: Omit<ChannelJobMessageInput<K>, 'text'> & {
    readonly kind: 'template';
    readonly template: string;
    /** JSON only: a Date as an ISO string, no Map, no class. */
    readonly context?: JsonObject;
    readonly locale?: string;
    readonly text?: undefined;
  };
}[C];

/** A job of a channel with its text, if any, given. */
export type ChannelContentJobInput<C extends OtherChannel = OtherChannel> = {
  [K in C]: ChannelJobMessageInput<K> & { readonly kind: 'content' };
}[C];

/** A message of a channel other than email to send through the queue. */
export type ChannelJobInput<C extends OtherChannel = OtherChannel> =
  | ChannelTemplateJobInput<C>
  | ChannelContentJobInput<C>;

/** A message to send through the queue, of email or of another channel. */
export type JobInput = EmailJobInput | ChannelJobInput;

/** An address as a job holds it. */
export interface JobAddress {
  readonly name?: string;
  readonly address: string;
}

/** An attachment as a job holds it: `data` in base64, or `ref`. */
export interface JobAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly inline: boolean;
  readonly contentId: string;
  readonly data?: string;
  readonly ref?: string;
}

interface EmailJobDataBase {
  readonly v: 1;
  readonly from: JobAddress;
  readonly to: readonly JobAddress[];
  readonly cc?: readonly JobAddress[];
  readonly bcc?: readonly JobAddress[];
  readonly replyTo?: readonly JobAddress[];
  readonly subject?: string;
  readonly attachments?: readonly JobAttachment[];
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
export interface EmailTemplateJobData extends EmailJobDataBase {
  readonly kind: 'template';
  readonly template: string;
  readonly context: JsonObject;
  readonly locale?: string;
}

/** The data of a content job, as stored. */
export interface EmailContentJobData extends EmailJobDataBase {
  readonly kind: 'content';
  readonly subject: string;
  readonly content: MessageContent;
}

/** The data of an email job, as stored: JSON only. */
export type EmailJobData = EmailTemplateJobData | EmailContentJobData;

/** A medium as a job holds it: a URL or an id, `data` in base64, or `ref`. */
export type JobMedium = {
  readonly contentType?: string;
  readonly filename?: string;
  readonly caption?: string;
} & (
  | { readonly url: string }
  | { readonly id: string }
  | { readonly data: string; readonly contentType: string }
  | { readonly ref: string; readonly contentType: string }
);

/** The data of a job of a channel, as stored: JSON only. */
export interface ChannelJobData {
  readonly v: 2;
  /** Sealed with the other fields by a codec, never in clear beside them. */
  readonly channel: OtherChannel;
  readonly kind: 'template' | 'content';
  readonly template?: string;
  readonly context?: JsonObject;
  readonly locale?: string;
  /** In E.164 for a phone, as normalized when the job was made. */
  readonly to?: ChannelMessage['to'];
  readonly from?: string;
  /** The text of a job of content. */
  readonly text?: string;
  readonly media?: readonly JobMedium[];
  readonly buttons?: readonly ChannelButton[];
  readonly payload?: JsonObject;
  readonly mentions?: ChannelMentions;
  readonly providerTemplate?: ProviderTemplate;
  readonly thread?: string;
  readonly title?: string;
  readonly data?: Readonly<Record<string, string>>;
  readonly priority: Priority;
  readonly tags?: readonly string[];
  /** Always with `correlationId`, which webhooks give back. */
  readonly metadata: Readonly<Record<string, string>>;
  readonly idempotencyKey: string;
  readonly tenantId?: string;
  readonly correlationId: string;
  readonly notBefore?: string;
  readonly expiresAt?: string;
  readonly enqueuedAt: string;
  readonly hash: string;
  readonly mac?: string;
  readonly kid?: string;
  readonly trace?: string;
}

/** The data of a job, as stored: JSON only. */
export type JobData = EmailJobData | ChannelJobData;

/**
 * A key that signs jobs: an HMAC-SHA256 key of 32 bytes at least. Of the keys
 * given, the first signs and each verifies, so a key is rotated by putting
 * the new one first and dropping the old one once its jobs are done.
 */
export interface JobSigningKey {
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
export interface JobCodec {
  encode(text: string): string | Promise<string>;
  /** Throws an error with `retryable: false` when the text can never be opened, so the job fails rather than waits. */
  decode(text: string): string | Promise<string>;
}

/** The identifiers a job derives rather than draws. */
export type JobDerivedIdKind = 'job-id' | 'message-id' | 'content-id';

/**
 * Makes an identifier a job derives of a seed, a SHA-256 in hexadecimal (an
 * HMAC under `idSecret` for the job id) of what it derives from. It must
 * give the same identifier for the same seed: unlike `generateId`, which
 * gives a new one at each call. A `job-id` is 1 to 128 printable ASCII
 * characters, no `:`, not all digits; the others are the left half of a
 * Message-ID or Content-ID (dot-atom-text, at most 256 characters).
 */
export type JobIdDeriver = (kind: JobDerivedIdKind, seed: string) => string;

/** The options of the jobs of a queue. */
export interface JobOptions {
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
  readonly signingKeys?: readonly JobSigningKey[];
  /**
   * The secret, 32 bytes at least, under which the id of a job is derived
   * from its key (an HMAC rather than a SHA-256), so that an id cannot be
   * traced back to a key that names a person. The same on every producer,
   * and never rotated: another secret makes other ids, and the same message
   * another job.
   */
  readonly idSecret?: string | Uint8Array;
  /**
   * Makes the id of each job, and the Message-ID and Content-IDs of a job
   * enqueued under a key, of the hash they derive from, in place of a UUID
   * of it: an id of your format, the same for the same key. The identifiers
   * a job draws (its key and Message-ID without a key of yours) come from
   * `generateId`.
   */
  readonly deriveId?: JobIdDeriver;
  /**
   * The country of a phone number of a job of SMS, RCS or WhatsApp written
   * without its calling code (`067 123 45 67` with `UA`), which the job holds
   * in E.164.
   */
  readonly defaultCountry?: string;
}

/** A job of a message: its data, and the request a driver takes. */
export interface PreparedJob<TData extends JobData = JobData> {
  readonly data: TData;
  readonly request: QueueJobRequest;
}

/**
 * Makes the job of a message. Its fields are checked as `createMessage`
 * checks them, and its Message-ID, Content-IDs and id fixed.
 *
 * @throws {TypeError} If a field is invalid.
 * @throws {RangeError} If the job or its attachments are too large.
 */
export declare function prepareJob(
  input: EmailJobInput,
  options?: JobOptions,
): PreparedJob<EmailJobData>;
export declare function prepareJob(
  input: ChannelJobInput,
  options?: JobOptions,
): PreparedJob<ChannelJobData>;
export declare function prepareJob(input: JobInput, options?: JobOptions): PreparedJob;

/**
 * Checks the data of a job read from its queue, opened if it was sealed.
 *
 * @throws {QueueError} `queue.invalid_job`; `queue.codec_missing` for a
 * sealed job; `queue.unsupported_version`
 * for a later version, or a field this version does not know; or
 * `queue.hash_mismatch`; `queue.signature_invalid` if `signingKeys` are given
 * and the job is not signed by one of them.
 * @throws {TypeError} If a signing key is invalid.
 */
export declare function parseJob(
  data: unknown,
  options?: { readonly signingKeys?: readonly JobSigningKey[] },
): JobData;

/** The code of a {@link QueueError}. */
export type QueueErrorCode =
  | 'queue.key_reused'
  | 'queue.invalid_job'
  | 'queue.unsupported_version'
  | 'queue.hash_mismatch'
  | 'queue.signature_invalid'
  | 'queue.codec_missing'
  | 'queue.codec_failed';

/** A failure of the queue, by its code. */
export declare class QueueError extends Error {
  readonly code: QueueErrorCode;
  /** `queue.key_reused`: the jobs whose keys were used before for other messages. */
  readonly jobIds?: readonly string[];
  /** `queue.key_reused` of `enqueueMany`: what the other jobs of the call gave. */
  readonly answers?: readonly EnqueueResult[];
  constructor(code: QueueErrorCode, message: string, options?: ErrorOptions);
}

/** The input a worker gives its renderer for a template job. */
export interface JobRenderInput {
  readonly template: string;
  readonly context: JsonObject;
  readonly locale?: string;
  readonly tenantId?: string;
  /** Aborts when the worker stops the job: a renderer may stop with it. */
  readonly signal?: AbortSignal;
}

/** What `classify` may decide of a failed receipt. */
export type FailureDecision = 'retry' | 'fail' | 'delivery_unknown' | undefined;

/** The backoff between attempts. */
export interface QueueBackoff {
  /** @default 30000 */
  readonly baseDelayMilliseconds?: number;
  /** @default 3600000 */
  readonly maxDelayMilliseconds?: number;
  /** @default 2 */
  readonly factor?: number;
}

/** The options of a worker, or of {@link createJobHandler}. */
export interface JobHandlerOptions {
  /**
   * The transport, decorated as the application chooses: of email, of a
   * channel, or a router of several (`./router`). Its own retries are
   * best few (`retries: 1`, no `RetryTransport`): the queue retries.
   */
  readonly transport: Transport<string, never>;
  /** The renderer of template jobs, such as one of `./templates`. */
  readonly renderer?: Renderer<JobRenderInput>;
  /**
   * The attachment of an email, or its content, a reference names; or the
   * medium of a message of a channel, its content or a URL (`{ url }`, such
   * as one signed for a while). Called again on each attempt.
   */
  readonly resolveAttachment?: (
    ref: string,
    context:
      | {
          readonly job: EmailJobData;
          readonly attachment: Omit<JobAttachment, 'data' | 'ref'>;
          readonly medium?: undefined;
          readonly signal: AbortSignal;
        }
      | {
          readonly job: ChannelJobData;
          readonly attachment?: undefined;
          readonly medium: {
            readonly contentType: string;
            readonly filename?: string;
            readonly caption?: string;
          };
          readonly signal: AbortSignal;
        },
  ) => unknown;
  /** Refuses a job, for good, by throwing: a sender not allowed. */
  readonly checkJob?: (data: JobData, job: QueueJob) => void | Promise<void>;
  /** Decides of a failed receipt in the place of the rules. */
  readonly classify?: (failure: {
    readonly receipt: Receipt;
    readonly job: QueueJob;
  }) => FailureDecision;
  readonly audit?: AuditSink;
  /** A sink that fails before the send makes the job retried, rather than sent unrecorded. @default false */
  readonly auditStrict?: boolean;
  /**
   * Only jobs signed by one of these keys are sent; any other fails with
   * `queue.signature_invalid`. A worker of a queue takes the queue's.
   */
  readonly signingKeys?: readonly JobSigningKey[];
  /**
   * Opens sealed jobs. A sealed job this worker cannot open waits for one
   * that can (`queue.codec_missing`, `queue.codec_failed`). A worker of a
   * queue takes the queue's.
   */
  readonly codec?: JobCodec;
  readonly backoff?: QueueBackoff;
  /** The wait before an attempt again after an `auth` or `configuration` failure. @default 300000 */
  readonly operatorDelayMilliseconds?: number;
  /**
   * What a rate limit makes wait, where the driver can: the job, the whole
   * queue, or the jobs of the job's tenant (the memory queue and the outbox).
   * @default 'job'
   */
  readonly rateLimitScope?: 'job' | 'queue' | 'tenant';
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
 * Makes the handler of jobs, for any driver: render, attachments,
 * message, send, and what the queue does with the receipt.
 *
 * @throws {TypeError} If an option is invalid.
 */
export declare function createJobHandler(options: JobHandlerOptions): QueueHandler;

/** The options of {@link createQueue}. */
export interface QueueOptions extends Omit<JobOptions, 'now'> {
  readonly driver: QueueDriver;
  readonly audit?: AuditSink;
  /** A sink that fails makes the enqueue fail, and the job retried before its send. @default false */
  readonly auditStrict?: boolean;
  /** Seals the fields of each job in the store; its workers open them. */
  readonly codec?: JobCodec;
  /**
   * The W3C `traceparent` of the producer, which each job carries as `trace`
   * for `instrumentHandler` of `./otel` to link its span to:
   * `() => { const carrier = {}; propagation.inject(context.active(), carrier); return carrier.traceparent; }`.
   */
  readonly traceContext?: () => string | undefined;
  readonly logger?: Logger;
  readonly now?: () => number;
}

interface EnqueueResultBase {
  /** The id of the job. */
  readonly id: string;
  readonly correlationId: string;
  /** true: a job of this key was held already, and nothing was added. */
  readonly duplicate: boolean | undefined;
}

/** What the enqueue of an email gives. */
export interface EmailEnqueueResult extends EnqueueResultBase {
  readonly messageId: string;
}

/** What the enqueue of a message of another channel gives. */
export interface ChannelEnqueueResult<
  C extends OtherChannel = OtherChannel,
> extends EnqueueResultBase {
  readonly channel: C;
}

/** What an enqueue gives. */
export type EnqueueResult = EmailEnqueueResult | ChannelEnqueueResult;

/** The options of a worker of a queue. */
export interface QueueWorkerOptions extends Omit<JobHandlerOptions, 'audit' | 'auditStrict'> {
  /** @default 1 */
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
}

/** A worker of a queue. */
export interface QueueWorker extends AsyncDisposable {
  /** Stops taking jobs and waits for those in flight, then aborts them. */
  close(options?: QueueCloseOptions): Promise<void>;
}

/** A queue of messages. */
export interface MessageQueue<TDriver extends QueueDriver = QueueDriver> {
  readonly driver: TDriver;
  /**
   * @throws {TypeError} If a field is invalid.
   * @throws {QueueError} `queue.key_reused` if its key was used for another message.
   */
  enqueue(input: EmailJobInput, options?: QueueEnqueueOptions): Promise<EmailEnqueueResult>;
  enqueue<C extends OtherChannel>(
    input: ChannelJobInput<C> & { readonly channel: C },
    options?: QueueEnqueueOptions,
  ): Promise<ChannelEnqueueResult<C>>;
  enqueue(input: JobInput, options?: QueueEnqueueOptions): Promise<EnqueueResult>;
  enqueueMany(
    inputs: Iterable<JobInput>,
    options?: QueueEnqueueOptions,
  ): Promise<readonly EnqueueResult[]>;
  createWorker(options: QueueWorkerOptions): QueueWorker;
}

/**
 * Makes a queue of messages over a driver.
 *
 * @example
 * ```js
 * const queue = createQueue({ driver: createMemoryQueue(), audit });
 * await queue.enqueue({
 *   kind: 'template', template: 'reset-password', context: { url },
 *   from: 'app@example.com', to: user.email, idempotencyKey: `reset:${resetRequest.id}`,
 * });
 * const worker = queue.createWorker({ transport, renderer: templates });
 * ```
 * @throws {TypeError} If an option is invalid.
 */
export declare function createQueue<TDriver extends QueueDriver>(
  options: QueueOptions & { readonly driver: TDriver },
): MessageQueue<TDriver>;

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
  /** See {@link QueueRetainData}. @default 'failed' */
  readonly retainData?: QueueRetainData;
  /**
   * `tenant`: high jobs of any tenant first, then the tenants' jobs in turn,
   * so that one tenant's backlog holds no other's mail. @default 'none'
   */
  readonly fairness?: 'none' | 'tenant';
}

/**
 * The finished jobs whose data, the message with its addresses and context,
 * a store keeps: `'failed'` those that failed, for a retry by hand; `'all'`;
 * or `'none'`. A job's version and hash stay, by which a duplicate is told.
 */
export type QueueRetainData = 'all' | 'failed' | 'none';

/** What a store of jobs holds. */
export interface QueueStats {
  /** Due now. */
  readonly ready: number;
  /** Not due yet: scheduled, or waiting to be retried. */
  readonly delayed: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  /** How long the oldest job due has waited: the lag of the workers. */
  readonly oldestReadyMilliseconds?: number;
  /** Until when the whole queue is paused. */
  readonly pausedUntil?: number;
  /** The tenants whose jobs are paused, and until when. */
  readonly pausedTenants?: readonly { readonly tenantId: string; readonly until: number }[];
}

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
  /** Ends a pause of the queue, or of one tenant's jobs, before its time. */
  resume(scope?: { readonly tenantId?: string }): Promise<void>;
  stats(): QueueStats;
  /** The failed jobs, by id, a page of `limit` (100) after `after`. */
  failed(options?: { readonly limit?: number; readonly after?: string }): readonly MemoryQueueJob[];
  /**
   * A failed job back to ready, its attempts anew: false when it is not a
   * failed job.
   * @throws {TypeError} If its data was dropped (`retainData`).
   */
  retryFailed(id: string): boolean;
}

/**
 * Makes a queue in memory, for tests and a single process.
 *
 * @throws {TypeError} If an option is invalid.
 */
export declare function createMemoryQueue(options?: MemoryQueueOptions): MemoryQueue;
