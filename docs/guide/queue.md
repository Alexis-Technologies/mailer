# The queue

`@alexify/mailer/queue` sends mail through a queue: a producer enqueues a
message as a job, and a worker renders it, sends it through the transport you
composed, and decides from the receipt what the queue does next. The queue is a
driver of your choice: [BullMQ](/transports/bullmq) on Redis or Valkey, the
[MongoDB outbox](/guide/outbox), the memory queue for tests, or an outbox of
your own store (a `QueueSource`).

```
producer   queue.enqueue(job) ──▶ driver (BullMQ, outbox, memory)
worker     driver ──▶ render ──▶ attachments ──▶ createMessage ──▶ transport.send ──▶ receipt
                                                                          │
           ack · retry after a delay · fail for good · release  ◀─────────┘
```

## Enqueue and work

```js
const { Queue, Worker } = require('bullmq');
const { createMailQueue } = require('@alexify/mailer/queue');
const { createBullMQDriver } = require('@alexify/mailer/bullmq');
const { createLoggerAuditSink } = require('@alexify/mailer/audit');

const driver = createBullMQDriver({ bullmq: { Queue, Worker }, connection: { host: 'valkey' } });
const queue = createMailQueue({ driver, audit: createLoggerAuditSink(logger), logger });

// The producer: an HTTP handler, a cron.
await queue.enqueue({
  kind: 'template',
  template: 'reset-password',
  context: { name: user.name, url },
  locale: user.locale,
  from: 'Hirevel <no-reply@example.com>',
  to: user.email,
  idempotencyKey: `reset-password:${resetRequest.id}`,
  priority: 'high',
  expiresAt: new Date(Date.now() + 15 * 60_000),
});

// The worker, in a process of its own or the same one.
const worker = queue.createWorker({
  transport: new IdempotencyTransport(new SesTransport({ ...config, retries: 1 }), { store }),
  renderer: templates,
  concurrency: 5,
});
process.on('SIGTERM', () => worker.close());
```

A job is `{ kind: 'template', template, context, locale }`, which the worker
renders with its `renderer` (such as one of [`./templates`](/messages/templates)),
or `{ kind: 'content', subject, content }`, rendered already, such as with React
Email in the producer. The other fields are those of
[`createMessage`](/messages/compose), plus:

| Field | What it does |
| --- | --- |
| `idempotencyKey` | the key the job is enqueued once under (one is made when absent) |
| `scheduledAt` | a delay of the queue: not sent before then |
| `expiresAt` | not sent after then: a code of sign-in sent late is of no use |
| `tenantId` | scopes the key of the job |
| `correlationId` | what the events of the message share, from the queue to the webhooks |
| `maxAttempts` | the attempts in all (5 by default) |

## What a job holds

A job is JSON, checked when it is enqueued, so a bad address fails the caller,
not the worker:

- the fields are checked as `createMessage` checks them;
- `context` must be JSON as it is: a `Date`, a `Map`, a class, `NaN` or a cycle is
  refused with the path to it (`context.user.createdAt is a Date; pass an ISO
  string`), so a template does not meet a string where it expected a date;
- an attachment goes as its bytes (base64, 256 KiB in all by default) or as
  `{ ref }`, which the worker's `resolveAttachment(ref, { job, attachment,
  signal })` reads, with `fromPath` or `fromUrl` of
  [`./attachments`](/messages/attachments). A job names no file or URL itself:
  whoever can write to the store could;
- the Message-ID and the Content-IDs are fixed, so every attempt sends the
  same message;
- a job is 256 KiB at most.

A job is of version 1 (`v: 1`), and its fields are those of that version. A
worker that meets a later version, or a field it does not know, gives the job
back for a worker that reads it (`queue.unsupported_version`) instead of
failing it for a hash it cannot recompute: during a rolling deploy, the jobs
the new producers write wait for the new workers. A field is never added to
version 1; a new field is a new version.

## Signed jobs

The hash of a job tells a job that changed in its store, but not one that was
forged: whoever can write to Redis or MongoDB can recompute a SHA-256, and a
worker would send their message from your domain, signed with your DKIM key.
Give the queue `signingKeys`, and each job is signed with an HMAC-SHA256 (`kid`
and `mac`); its workers send only jobs that one of the keys signed, and fail
any other with `queue.signature_invalid`, unsent, logged at `error`:

```js
const queue = createMailQueue({
  driver,
  signingKeys: [{ id: '2026-10', secret: process.env.MAIL_JOB_KEY }], // 32 bytes at least
});
const worker = queue.createWorker({ transport }); // verifies with the queue's keys
```

The first key signs and each one verifies. To rotate, put the new key first,
deploy the workers, then the producers, and drop the old key once no job it
signed is left. A worker without keys checks the hash alone, so give every
worker the keys before any producer.

## Sealed jobs

A job holds its message in clear: its addresses, its context (a link of a
password reset among it) and its attachments, in Redis or MongoDB for as long
as the job is kept, and in their backups. Give the queue a `codec`, and the
store holds what it made of them:

```js
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const key = Buffer.from(process.env.MAIL_DATA_KEY, 'base64'); // 32 bytes

const codec = {
  encode(text) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const sealed = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString('base64');
  },
  decode(text) {
    const bytes = Buffer.from(text, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString();
  },
};
const queue = createMailQueue({ driver, codec, signingKeys });
```

A sealed job keeps in clear only `v`, `hash` (a duplicate is still told by
it), `enqueuedAt`, `kid`, `mac` and `trace`; the rest is `enc`. Its workers
take the queue's codec. A worker without it, or whose codec throws (a key out
of reach), gives the job back for a worker that can open it
(`queue.codec_missing`, `queue.codec_failed`); a codec that throws an error
with `retryable: false` fails it. Encryption is not a signature: a writer who
can seal can still forge, so seal with `signingKeys` too.

## Once per key

The id of a job is a UUID of its namespace, tenant and `idempotencyKey`: the
same message enqueued again is the same job (`duplicate: true`), and another
message under the key is refused with `MailQueueError` `queue.key_reused`.
The worker gives the message that id as its `idempotencyKey`, so
[`IdempotencyTransport`](/transports/idempotency), with a store the workers
share, and the providers that take a key (Resend, Lettermint, Brevo, Azure)
dedupe it again. A worker that died mid-send leaves the key reserved, and the
attempt again is of unknown delivery (`delivery_unknown`), not a second send.

The rendering must then be the same for the same context: no `Date.now()` in a
template, or an attempt again is refused as another message.

The id of a job is a hash of its key, and it goes where addresses do not: into
the audit, the logs, the provider's idempotency key and the Message-ID. A key
is an id of what the message tells of (`reset-password:${resetRequest.id}`),
never an address or a token: a SHA-256 of `welcome:ada@example.com` is found
again by hashing the addresses one knows. `idSecret` (32 bytes at least)
derives the id with an HMAC instead; it is the same on every producer and never
rotated, as another secret makes other ids and the same message another job.

## What the queue does with an attempt

| The attempt | The queue | The state |
| --- | --- | --- |
| accepted | done | `accepted` |
| a failure of unknown delivery (a timeout after the request, a key in flight, the worker stopped mid-send) | failed for good, never sent blindly again | `delivery_unknown` |
| a retryable failure, attempts left | retried after the backoff, never sooner than the provider's `Retry-After` | `queued` |
| a retryable failure, the last attempt | failed (`queue.attempts_exhausted`) | `failed` |
| a refused message (`validation`, `rejected`, `unsupported`) | failed at once | `failed` |
| a failure of the operator (`auth`, `configuration`) | retried after `operatorDelayMilliseconds` (5 minutes) | `queued` |
| a template missing or broken, no subject, no renderer | failed at once (`render.*`) | `failed` |
| an outage of the template loader or of `resolveAttachment` | retried | `queued` |
| a bug: a `TypeError` thrown by the transport | failed at once (`queue.thrown`), logged with its stack | `failed` |
| a job past `expiresAt`, or whose retry would come after it | failed (`queue.expired`) | `failed` |
| a job written by a later version of the worker | retried, for a worker of that version | `queued` |
| the worker stops before the send | given back, its attempt not spent | — |

The backoff is exponential with full jitter: 30 seconds, doubled per attempt,
an hour at most (`backoff`). A `Retry-After` is a minimum, with a little jitter
over it, so that a rate limit does not bring every job back at once.
`rateLimitScope: 'queue'` makes a rate limit pause the whole queue where the
driver can. `classify({ receipt, job })` decides in the place of these rules
(`'retry'`, `'fail'`, `'delivery_unknown'`, or `undefined` for the rules), and
`checkJob(data, job)` refuses a job for good by throwing.

**The queue retries; the transport should not.** Each attempt of a
`RetryTransport` inside the worker holds the job and multiplies its attempts:
give the providers `retries: 1` (they retry only what was provably not sent)
and leave `RetryTransport` out.

## The audit and the log

The worker tells the [audit sink](/guide/audit) each state: `queued` at the
enqueue (in the transaction of an outbox), `rendered`, `submitted` just before
the send, then `accepted`, `failed` or `delivery_unknown`, and `queued` again
for a retry. A sink that fails is a warning (`MAILER_AUDIT_FAILED`);
`auditStrict: true` makes it retry the job before the send, so that no message
goes unrecorded.

`logger`, pino-like, hears what the queue does, never an address: the
enqueues and the starts at `debug`, the sends at `info`, the retries,
redeliveries and releases at `warn`, the failures at `error` with their code,
category and reason.

## Several processes

A job is shared by every worker of its driver; the key store of
`IdempotencyTransport` must be shared too (`createMongoIdempotencyStore`, or
one on Redis), or a crash mid-send can be sent twice. The breaker and the rate limit of the chain are
per process unless given a shared store (see
[getting started](/guide/getting-started#several-processes)).

## The memory queue and the polling driver

`createMemoryQueue()` is a queue in memory for tests and a single process,
with `list()`, `get(id)`, `drain()` and `wake()`, and `now` and `sleep` for a
clock of the tests. It is the polling driver over a source in memory:
`createPollingDriver(source)` makes a driver of any `QueueSource`, a store that
lends its jobs (`reserve`, `extend`, `ack`, `retry`, `fail`, `release`), such
as an outbox in your database. It keeps the lease of a job while it runs, gives
a job whose lease ran out to another worker as `redelivered`, and on `close()`
waits for the jobs in flight, then aborts them.
