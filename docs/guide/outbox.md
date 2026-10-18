# MongoDB outbox

`@alexify/mailer/mongodb` keeps the [mail queue](/guide/queue) in a collection
of MongoDB: the transactional outbox. A job is written in the transaction of
your own writes, so a message is queued exactly when what it tells of is
committed, with no Redis. The same subpath keeps the [audit](/guide/audit) and
the keys of [`IdempotencyTransport`](/transports/idempotency) in MongoDB. The
package depends on no MongoDB driver: you pass in its collections.

```js
const { randomUUID } = require('node:crypto');
const { MongoClient } = require('mongodb');
const { createMailQueue } = require('@alexify/mailer/queue');
const { IdempotencyTransport } = require('@alexify/mailer/idempotency');
const {
  createMongoAuditSink,
  createMongoIdempotencyStore,
  createMongoOutbox,
} = require('@alexify/mailer/mongodb');

const client = new MongoClient(process.env.MONGODB_URL);
const db = client.db('app');

const outbox = createMongoOutbox({ collection: db.collection('mail_outbox'), changeStream: true });
const audit = createMongoAuditSink({ collection: db.collection('mail_audit') });
const store = createMongoIdempotencyStore({ collection: db.collection('mail_idempotency') });
await Promise.all([outbox.ensureIndexes(), audit.ensureIndexes(), store.ensureIndexes()]);

const queue = createMailQueue({ driver: outbox, audit });

// The producer: the job and its audit event go in the transaction.
const session = client.startSession();
await session.withTransaction(async () => {
  const resetId = randomUUID(); // the key names the request, never its token
  await db.collection('resets').insertOne({ _id: resetId, userId: user.id, token }, { session });
  await queue.enqueue(
    {
      kind: 'template',
      template: 'reset-password',
      context: { url },
      from: 'no-reply@example.com',
      to: user.email,
      idempotencyKey: `reset-password:${resetId}`,
    },
    { transaction: session },
  );
});

// A worker, in as many processes as you like.
queue.createWorker({
  transport: new IdempotencyTransport(new SesTransport({ ...config, retries: 1 }), { store }),
  renderer: templates,
  concurrency: 5,
});
```

If the transaction aborts, neither the job nor its `queued` event is written.
A job enqueued again under its key in the transaction is a duplicate, and does
not abort it: the outbox writes with an upsert, never an insert that would
fail on the key.

## How workers share it

The outbox is a `QueueSource`, read by the polling driver of `./queue`:

- a job is lent by one atomic `findOneAndUpdate`, the next ready one by
  priority, then time, under a token of its own, for the lease
  (`leaseMilliseconds`, a minute), which the worker extends while it runs;
- every later write of that run (done, retried, failed, given back) is fenced
  by the token: a worker whose lease ran out writes nothing;
- a job whose lease ran out (its worker died) is ready again, its attempt run
  again, `redelivered`;
- a rate limit of the whole queue (`rateLimitScope: 'queue'`) pauses every
  worker, and one of a tenant (`'tenant'`) that tenant's jobs alone, through
  documents of their own (`mailer:pause`, `mailer:pause:<tenant>`), which
  `outbox.resume()` ends early;
- with `fairness: 'tenant'`, a lane takes a `high` job of any tenant first,
  then the tenants with jobs ready in turn (read with `distinct` once a poll
  interval): two round trips a job.

Leases are written by the clock of each worker, so a lease is taken back only
`clockSkewToleranceMilliseconds` (5 s) after it ran out, lest a worker whose
clock is behind still holds it; keep the clocks of the workers in sync (NTP),
within that tolerance, and the lease more than three times longer.

Workers poll (`pollIntervalMilliseconds`, a second). An idle poll of a lane is
one `findOneAndUpdate` and one read of when the next job is due: a process
takes back the leases that ran out once a third of a lease, and reads the
pause of the queue once a poll interval (a pause of its own at once). With `changeStream: true`,
on a replica set, a change after which a job may be ready (an enqueue, a
retry, a release, a lease taken back) wakes one lane at once, and the poll is
only the fallback; the outbox's own leases and settlings wake none. A stream
that fails is opened again a second later, then up to every 30 seconds
(`queue.change_stream_failed`).

## Indexes and retention

`ensureIndexes()` makes:

| Collection | Index |
| --- | --- |
| outbox | `{ state, rank, availableAt, enqueuedAt }` for the ready jobs; `{ state, leaseUntil }` for the leases; `{ state, availableAt }` for the next one due; `{ state, tenantId, rank, availableAt, enqueuedAt }` for the tenants in turn; a TTL on `expireAt` |
| audit | `{ correlationId, at, attempt, rank }`; `{ jobId }` |
| idempotency | a TTL on `expiresAt` |

A completed job is kept `dedupeWindowSeconds` (a day), and while it is kept,
an enqueue under its key is a duplicate: the retention is the window of
deduplication. A failed job is kept `retainFailedSeconds` (a week), for a retry
by hand. Both are the same options, with the same defaults, on every driver. A key of the store goes when its time passes. A completed job
keeps no `data`, only its hash (`retainData: 'failed'`, the default; `'all'`
or `'none'`), so a reset link in it does not wait a week in the collection and
its backups.

## A job as stored

```js
{
  _id: '1b9d…',          // the id of the job: a UUID of namespace, tenant and key
  name: 'mail', data: { … }, hash: '…',
  priority: 'high', rank: 0, maxAttempts: 5,
  state: 'ready',        // 'active', 'completed', 'failed'
  attempts: 0, availableAt: ISODate(…), enqueuedAt: ISODate(…),
  token: null, leaseUntil: null, redelivered: false,
  redeliveries: 0,       // the runs that ended unsettled, never counted down
  failure: { code, reason },   // of the last failed attempt
  result: { provider, providerMessageId },
  finishedAt: ISODate(…),
  expireAt: ISODate(…),  // when the TTL drops it: dedupeWindowSeconds or retainFailedSeconds on
}
```

`outbox.get(id)` reads one. `outbox.stats()` gives its jobs by state (`ready`,
`delayed`, `active`, `completed`, `failed`), how long the oldest job due has
waited (`oldestReadyMilliseconds`, the lag of the workers, to alert on) and its
pauses; `outbox.failed({ limit, after })` lists the failed jobs a page at a
time, and `outbox.retryFailed(id)` sends one again, its attempts anew, before
`retainFailedSeconds` drops it. The data of a job is stored as it is, a token of a
reset link among it, unless the queue seals it with a
[codec](/guide/queue#sealed-jobs): restrict who reads the collection.

## The audit and the keys

`createMongoAuditSink` writes each event once by its id (an upsert), in the
transaction it is given, with `eventsOf(correlationId)` in their order and
`stateOf(correlationId)`. `createMongoIdempotencyStore` makes each step of
`IdempotencyTransport` atomic, so that of two workers sending one key, one
sends and the other is told it is in flight; a worker that died mid-send
leaves the key reserved, and the attempt again is of unknown delivery, not a
second send.

`pnpm test:mongodb` runs all three on MongoDB (`tests/mongodb/docker-compose.yml`,
a replica set of one).
