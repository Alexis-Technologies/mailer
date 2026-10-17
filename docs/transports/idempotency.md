# Idempotency

`IdempotencyTransport` sends a message with an idempotency key once. A later
send under the same key answers with the receipt of the first, so a job that
runs twice, or a retry after a timeout, does not send the message twice. It
comes from the idempotency middleware of unemail.

## Basic usage

```js
const { createMessage } = require('@alexify/mailer');
const { IdempotencyTransport } = require('@alexify/mailer/idempotency');

const transport = new IdempotencyTransport(ses);

await transport.send(
  createMessage({
    from: 'shop@example.com',
    to: user.email,
    subject: 'Welcome',
    content: { html: '<p>Welcome aboard.</p>' },
    idempotencyKey: `welcome:${user.id}`,
  }),
);
```

## How a key is kept

The key is reserved in the store before the message is sent, so of two sends
under one key, only one goes:

| Found under the key | Answer |
| --- | --- |
| nothing | the key is reserved, the message sent |
| a send still in flight | a receipt of unknown delivery (code `idempotency.in_flight`), not sent |
| a send that went, or may have gone | the receipt of that send |
| another message | refused as `validation` (code `idempotency.key_reused`) |

A send that failed frees its key for another attempt; one of unknown delivery
(`deliveryUnknown`, or one the caller aborted after it began, code
`idempotency.aborted`) keeps it, as the message may have gone. A message is
told from another by a fingerprint of its addresses, subject, body, header
fields, the names and types of its attachments (not their bytes), its
threading, schedule, tracking and metadata. A message without a key goes as it
is.

A key is reserved for `leaseMs` (ten minutes), and the receipt of its send is
kept for `ttlMs` (a day). The lease bounds how long a process that crashed, or
a batch left before its end, holds a key: after it, a send under the key goes.
So the lease must be longer than a send takes with all its attempts, or a
second send may go while the first is still out; and a crash after the
provider took the message, before its receipt was kept, lets the message go
again once the lease has passed. The decorator sends at least once with
deduplication, not exactly once.

When the store fails to reserve a key, that message alone fails, retryable
(`idempotency.store_failed`); when it fails to keep the receipt of a send that
went, the receipt still comes back and the failure becomes a process warning
(`MAILER_IDEMPOTENCY_STORE_FAILED`). The receipts the decorator makes, except
`key_reused`, are of the category `unknown`, so [`./breaker`](/transports/breaker)
does not count them against the provider, whatever the key says.

## Stores

The default store is in this process: it deduplicates across the transports
given it, not across processes, and forgets on a restart. For several
processes, pass a store on a shared database. It has three methods, each one
atomic step:

| Method | Does |
| --- | --- |
| `reserve(key, fingerprint, leaseMs)` | When no record holds the key within its time, holds it `pending` for `leaseMs` under a new token that cannot be guessed and resolves to `{ token }`; otherwise resolves to `{ record }`, the `state`, `fingerprint` and, once `done`, `receipt` of what holds it. |
| `complete(key, token, { fingerprint, receipt }, ttlMs)` | Keeps the key `done` with the receipt for `ttlMs`, when `token` holds it or nothing does. |
| `release(key, token)` | Frees the key, when `token` holds it `pending`. |

The token fences a reservation. Once the lease of a `pending` key has passed,
another `reserve` may take it under a new token; the first process, slow
rather than gone, then calls `complete` or `release` with its old token, and
the store must leave the new owner's key alone. A `reserve` that answers
anything but one of `{ token }` and `{ record }` fails the message as
`idempotency.store_failed`, as sending it could send it twice.

On Redis 7 with node-redis 4, `SET NX GET` reserves in one command, and a
script checks the token before it writes:

```js
const { randomUUID } = require('node:crypto');

// Writes the done record unless a record of another token holds the key.
const COMPLETE = `
local current = redis.call('GET', KEYS[1])
if current and cjson.decode(current).token ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1`;
// Deletes the key while ARGV[1] holds it pending.
const RELEASE = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local record = cjson.decode(current)
if record.token ~= ARGV[1] or record.state ~= 'pending' then return 0 end
return redis.call('DEL', KEYS[1])`;

const redisStore = {
  async reserve(key, fingerprint, leaseMs) {
    const token = randomUUID();
    const pending = JSON.stringify({ state: 'pending', fingerprint, token });
    const current = await redis.set(key, pending, { NX: true, GET: true, PX: leaseMs });
    return current === null ? { token } : { record: JSON.parse(current) };
  },
  async complete(key, token, { fingerprint, receipt }, ttlMs) {
    const done = JSON.stringify({ state: 'done', fingerprint, receipt, token });
    await redis.eval(COMPLETE, { keys: [key], arguments: [token, done, String(ttlMs)] });
  },
  async release(key, token) {
    await redis.eval(RELEASE, { keys: [key], arguments: [token] });
  },
};
```

On MongoDB, the unique `_id` makes the reservation atomic: an upsert that
matches only an expired record collides with a live one.

```js
const { randomUUID } = require('node:crypto');

const keys = db.collection('idempotency');
// Removes expired records in the background; the filters do not wait for it.
await keys.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const DUPLICATE_KEY = 11000;

const mongoStore = {
  async reserve(key, fingerprint, leaseMs) {
    for (;;) {
      const token = randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + leaseMs);
      try {
        await keys.updateOne(
          { _id: key, expiresAt: { $lte: now } },
          { $set: { state: 'pending', fingerprint, token, expiresAt }, $unset: { receipt: '' } },
          { upsert: true },
        );
        return { token };
      } catch (error) {
        if (error.code !== DUPLICATE_KEY) throw error;
      }
      const held = await keys.findOne({ _id: key, expiresAt: { $gt: new Date() } });
      if (held !== null) {
        const record = { state: held.state, fingerprint: held.fingerprint, receipt: held.receipt };
        return { record };
      }
      // Freed or expired since the upsert: reserve it again.
    }
  },
  async complete(key, token, { fingerprint, receipt }, ttlMs) {
    try {
      const expiresAt = new Date(Date.now() + ttlMs);
      await keys.updateOne(
        { _id: key, $or: [{ token }, { expiresAt: { $lte: new Date() } }] },
        { $set: { state: 'done', fingerprint, receipt, token, expiresAt } },
        { upsert: true },
      );
    } catch (error) {
      // Another token holds the key.
      if (error.code !== DUPLICATE_KEY) throw error;
    }
  },
  async release(key, token) {
    await keys.deleteOne({ _id: key, token, state: 'pending' });
  },
};
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `store` | in-process | `reserve`, `complete` and `release` of the keys. |
| `leaseMs` | `600000` | How long a key stays reserved for a send. |
| `ttlMs` | `86400000` | How long the receipt of a send is kept under its key. |
| `key` | `message.idempotencyKey` | The key of a message. |
| `namespace` | the wrapped transport's id | The prefix of the keys in the store. |
| `logger` | | A pino-like logger: a send answered as before at `debug`, one in flight at `info`, a key used again and a store that throws at `warn`. |

`createMemoryIdempotencyStore({ maxEntries, now })` makes the in-process store,
whose tokens come from `crypto.randomUUID()`. It keeps at most `maxEntries`
keys (100000): to make room, it drops the expired keys first, then the oldest
`done` ones, still within their time, so a message sent again under one of
them goes again. A `pending` key is never dropped before its lease ends.

Put this decorator outside `./retry` and `./pool`, so that a message is reserved
once for all their attempts. `sendMany()` goes through the `sendMany()` of the
wrapped transport, a message whose key was used before, in the batch too,
answered in place. A raw message has no `idempotencyKey`, so `sendRaw()` checks
only the key `key` gives it, its fingerprint its envelope.
