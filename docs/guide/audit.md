# The audit

`@alexify/mailer/audit` keeps what happened to each message: one event per
change of its state, from the queue to the provider's webhooks, all with its
`correlationId`. A sink is anything with `append(event)`; the package gives
one in memory, one of your logger, and the mapping of [delivery
events](/guide/webhooks).

## States

```
queued ─▶ rendered ─▶ submitted ─▶ accepted ─▶ delivered │ bounced │ complained
   ▲                      │
   └──── queued again ◀───┤ (a retry)
                          ├─▶ failed            (no attempt again)
                          └─▶ delivery_unknown  (it may have been taken)
```

`stateOf(events)` reads the state of a message from its events whatever their
order: a `delivered` from a webhook settles a `delivery_unknown`, a `bounced`
comes after a `delivered`. `isFinalState` is true for `delivered`, `bounced`,
`complained` and `failed`.

## An event

```js
{
  id: '…',                 // the same for the same change: a sink writes it once
  state: 'accepted',
  at: '2026-10-18T09:00:00.000Z',
  source: 'worker',        // 'producer', 'worker' or 'webhook'
  correlationId: '…',
  jobId: '…', tenantId: 'acme', attempt: 1,
  payloadHash: '…',        // the job as enqueued
  messageHash: '…',        // the message as rendered
  messageId: '…@example.com', provider: 'ses', providerMessageId: '…',
  priority: 'high', template: 'reset-password', tags: ['auth'],
  error: { category, code, message, retryable },  // for a failure, redacted
  retryAt: '…',            // for a retry
}
```

An event holds no recipient: the message is found by its `correlationId`. Its
`id` is the same however often it is told, and a sink that can tell whether it
holds one (`has(id)`: the memory and MongoDB sinks, and combined sinks when one
of them can) lets a worker know a run that submitted before it died.

## Sinks

```js
const {
  combineAuditSinks,
  createLoggerAuditSink,
  createMemoryAuditSink,
} = require('@alexify/mailer/audit');

const audit = combineAuditSinks(createLoggerAuditSink(logger), myDatabaseSink);
```

- `createMemoryAuditSink({ maxEvents })` holds the events, with
  `eventsOf(correlationId)` and `stateOf(correlationId)`: for tests.
- `createLoggerAuditSink(logger, { levels })` writes each event as a record
  `mail.<state>`: `failed` at error; `delivery_unknown`, `bounced` and
  `complained` at warn.
- `combineAuditSinks(...sinks)` tells each in turn, whatever another threw.
- `createMongoAuditSink({ collection })` of [`./mongodb`](/guide/outbox), each
  event once by its id, in the transaction of the enqueue.
- Your own: `{ append(event, { transaction }) }`. An outbox writes the
  `queued` event in the transaction of the enqueue; a sink keyed by `id`
  writes an event once however often it is told.

## Webhooks

```js
const { auditEventOfDeliveryEvent } = require('@alexify/mailer/audit');

const { events, commit } = await verifier.verify(request);
for (const event of events) {
  const audited = auditEventOfDeliveryEvent(event);
  if (audited !== undefined) await audit.append(audited);
}
await commit();
```

`accepted`, `delivered`, `bounced` and `complained` are states; `rejected` is
`failed`; `deferred` keeps a message accepted; an open, a click and an
unsubscribe are engagement, not states. The queue writes `correlationId` into
the metadata of each message, which the providers give back with its events.

## Messages to reconcile

A message whose last state is `submitted` long after its send, or
`delivery_unknown`, may have gone or not: its worker died after the request,
a timeout came after the provider took it, or BullMQ gave the job up after it
stalled too often (the driver tells the queue's sink `delivery_unknown`, code
`queue.lost`). Find them, then settle each from the provider's webhooks or its
dashboard rather than send it again. On MongoDB:

```js
const stale = await db
  .collection('mail_audit')
  .aggregate([
    { $sort: { correlationId: 1, at: 1, attempt: 1, rank: 1 } },
    { $group: { _id: '$correlationId', state: { $last: '$state' }, at: { $last: '$at' } } },
    {
      $match: {
        state: { $in: ['submitted', 'delivery_unknown'] },
        at: { $lt: new Date(Date.now() - 15 * 60_000) },
      },
    },
  ])
  .toArray();
```
