# Rate limit

`RateLimitTransport` sends through a transport at most `limit` messages every
`intervalMs`, with bursts up to `burst`: a token bucket in front of it, per key.
It comes from the rate limit of unemail.

## Basic usage

```js
const { RateLimitTransport } = require('@alexify/mailer/ratelimit');

// SES at 14 messages a second, which it counts per recipient.
const transport = new RateLimitTransport(ses, {
  limit: 14,
  cost: (message) =>
    message.recipients.length + message.ccRecipients.length + message.bccRecipients.length,
});
```

## Waiting and refusing

A bucket holds `burst` tokens and gains `limit` every `intervalMs`; a message
takes `cost(message)` of them, 1 without `cost`.

- In `wait` mode, the default, a message waits for its tokens, first in, first
  out, behind those already waiting. An abort of the caller takes it out of the
  queue and rejects with the signal's reason.
- A message the queue ahead of it would hold longer than `maxWaitMs`, counted
  from its arrival, is answered at once, as is any that would wait in `reject`
  mode: a retryable `rate-limit` receipt (code `ratelimit.limited`) with the
  wait in `retryAfterMilliseconds`, which `./retry` waits for.
- A cost over `burst`, which no bucket could ever hold, is refused as
  `configuration`, not retryable.

## Per key

`key(message)` chooses the bucket, such as a tenant's, so one tenant's burst
does not hold back the others. No more than `maxKeys` buckets are kept: past
it, the least used one with no waiter is dropped, and its key starts full when
it comes back, the price of a bound on memory. Disposing of the transport stops
the waits, each rejecting with an `AbortError`.

```js
const perTenant = new RateLimitTransport(transport, {
  limit: 10,
  key: (message) => message.metadata?.tenant ?? 'default',
});
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `limit` | (required) | The tokens a bucket gains every `intervalMs`. |
| `intervalMs` | `1000` | The interval of `limit`, in milliseconds. |
| `burst` | `limit` | The tokens a bucket holds. |
| `mode` | `'wait'` | `'wait'` or `'reject'`. |
| `maxWaitMs` | `30000` | The longest wait, from the arrival. |
| `key` | one bucket | The bucket of a message. |
| `cost` | `1` | The tokens a message takes. |
| `maxKeys` | `10000` | The most buckets kept, the least used dropped first. |
| `now` | `Date.now` | The clock. |
| `logger` | | A pino-like logger: a refused send (`ratelimit.limited`) at `info`, a send that waits at `debug`. |

`sendMany()` goes through the `sendMany()` of the wrapped transport, each
message handed to it once it has its tokens, so a batch is throttled like as
many sends; a transport that reads a batch ahead may still send it at once.
`sendRaw()` is throttled as `send()` is, and `verify()` takes no tokens.
