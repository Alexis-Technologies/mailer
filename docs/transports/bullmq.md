# BullMQ

`createBullMQDriver` is a driver of the [mail queue](/guide/queue) over
[BullMQ](https://docs.bullmq.io), on Redis or Valkey. The package depends on
neither: you pass in BullMQ's `Queue` and `Worker` classes.

```js
const { Queue, Worker } = require('bullmq');
const { createMailQueue } = require('@alexify/mailer/queue');
const { createBullMQDriver } = require('@alexify/mailer/bullmq');

const driver = createBullMQDriver({
  bullmq: { Queue, Worker },
  connection: { host: 'valkey', port: 6379 },
  prefix: 'app',
});
const queue = createMailQueue({ driver });
```

A process that only enqueues passes `{ Queue }`, or a queue of its own
(`{ Queue: myQueue }`), which the driver does not close.

## The jobs it adds

| BullMQ option | Set to |
| --- | --- |
| `jobId` | the id of the job: an add again under it keeps the first job |
| `attempts` | the attempts of the job (5 by default) |
| `backoff` | `{ type: 'alexify-mailer' }`: the delay the queue chose |
| `priority` | `high` 1, `normal` 2, `low` 3 (`priorities`); never 0, which BullMQ runs before every prioritized job |
| `delay` | until `scheduledAt` |
| `removeOnComplete`, `removeOnFail` | a day and a week, by time (`jobOptions`) |

A duplicate is told by reading the job back (`detectDuplicates`, one read per
enqueue; `'bulk'` for `enqueueMany` too). It holds while BullMQ keeps the
job, so the retention is by time: one by count shrinks the window of
duplicates as the queue gets busy. `deduplication` of BullMQ is not used, as
it holds only while the first job is not finished.

## The workers it makes

`queue.createWorker()` makes a BullMQ `Worker` with your `workerOptions`
(`lockDuration`, `maxStalledCount`, `limiter`…) and a backoff strategy that
reads the delay of each retry. Each outcome of a run is what BullMQ takes:

| Outcome | To BullMQ | Its attempt |
| --- | --- | --- |
| ack | the job's return value | spent, completed |
| retry | an error, its delay read by the strategy | spent |
| retry of the queue (`rateLimitScope: 'queue'`, with `limiter`) | `queue.rateLimit(ms)`, then `RateLimitError` | not spent |
| fail | `UnrecoverableError`, its reason redacted | spent, failed |
| release | `moveToDelayed` or `moveToWait`, then `DelayedError` or `WaitingError` | not spent |

BullMQ reads these errors by their name, so the package imports nothing of it.
The processor takes BullMQ's signal (from BullMQ 5.7x) and its own: on
`close({ timeoutMilliseconds })`, the jobs still running past the timeout are
aborted, and a job not yet sent goes back.

The driver logs what BullMQ does on its own: a job it failed itself, such as
one stalled more than `maxStalledCount` times, which the handler never saw
(`queue.job.lost`), a stall, and the errors of the worker.

## A Worker of your own

```js
const { Worker } = require('bullmq');
const { createMailJobHandler } = require('@alexify/mailer/queue');
const { createBullMQBackoffStrategy, createBullMQProcessor } = require('@alexify/mailer/bullmq');

const processor = createBullMQProcessor(createMailJobHandler({ transport, renderer }));
new Worker('mail', processor, {
  connection,
  settings: { backoffStrategy: createBullMQBackoffStrategy(myOtherStrategy) },
});
```

Without that strategy, BullMQ cannot retry a mail job: it fails with "Unknown
backoff strategy alexify-mailer".

## Notes

- Per-tenant fairness (groups) is a feature of BullMQ Pro, not of BullMQ.
- BullMQ wants Redis or Valkey with `maxmemory-policy noeviction`.
- The data of a job is in Redis as it is, a token of a reset link among it: use
  Redis ACLs and TLS.
- `pnpm test:bullmq` runs the driver on BullMQ and Valkey
  (`tests/bullmq/docker-compose.yml`).
