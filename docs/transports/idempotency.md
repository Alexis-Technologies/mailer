# Idempotency

`IdempotencyTransport` sends a message with an idempotency key once. A later
send under the same key answers with the receipt of the first, so a job that
runs twice, or a retry after a crash, does not send the message twice. It comes
from the idempotency middleware of unemail.

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
(`deliveryUnknown`, or one the caller aborted after it began) keeps it, as the
message may have gone. A message is told from another by a fingerprint of its
addresses, subject, body, header fields, the names and types of its
attachments (not their bytes), its threading, schedule, tracking and metadata.
A message without a key goes as it is.

When the store fails to reserve a key, that message alone fails, retryable
(`idempotency.store_failed`); when it fails to keep the receipt of a send that
went, the receipt still comes back and the failure becomes a process warning
(`MAILER_IDEMPOTENCY_STORE_FAILED`).

## Stores

The default store is in this process: it deduplicates across the transports
given it, not across processes, and forgets on a restart. For several
processes, pass a store on a shared database whose `reserve` is atomic:

```js
const redisStore = {
  // SET NX reserves the key; the record is JSON.
  async reserve(key, fingerprint, ttlMs) {
    const pending = JSON.stringify({ state: 'pending', fingerprint });
    const ok = await redis.set(key, pending, { NX: true, PX: ttlMs });
    if (ok) return undefined;
    return JSON.parse(await redis.get(key));
  },
  async complete(key, { fingerprint, receipt }, ttlMs) {
    await redis.set(key, JSON.stringify({ state: 'done', fingerprint, receipt }), { PX: ttlMs });
  },
  async release(key) {
    await redis.del(key);
  },
};
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `store` | in-process | `reserve`, `complete` and `release` of the keys. |
| `ttlMs` | `86400000` | How long a key is kept. |
| `key` | `message.idempotencyKey` | The key of a message. |
| `namespace` | the wrapped transport's id | The prefix of the keys in the store. |

`createMemoryIdempotencyStore({ maxEntries, now })` makes the in-process store,
which keeps at most `maxEntries` keys (100000), dropping the oldest first.

Put this decorator outside `./retry` and `./pool`, so that a message is reserved
once for all their attempts. `sendMany()` goes through the `sendMany()` of the
wrapped transport, a message whose key was used before, in the batch too,
answered in place. A raw message has no `idempotencyKey`, so `sendRaw()` checks
only the key `key` gives it, its fingerprint its envelope.
