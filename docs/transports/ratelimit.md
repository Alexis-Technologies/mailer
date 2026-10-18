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
it, the least used full one is dropped, which loses nothing; when none is full,
the least used one with no waiter goes, its key starting full when it comes
back, the price of a bound on memory, and a warning says so
(`MAILER_RATELIMIT_EVICTED`, or `ratelimit.evicted` to the logger). No more than
`maxQueue` messages wait in one bucket, whatever `maxWaitMs` allows. Disposing
of the transport stops the waits, each rejecting with an `AbortError`.

```js
const perTenant = new RateLimitTransport(transport, {
  limit: 10,
  key: (message) => message.metadata?.tenant ?? 'default',
});
```

## Several processes

The buckets are those of the process: N replicas each send `limit` a second,
N times the quota of the provider. Give them a `store` they share, whose `take`
refills and takes in one step, and the limit is one. A send then waits for the
time the store says, as long as `maxWaitMs` allows, and is refused past it.

```js
// Redis: a token bucket in a script, on the clock of Redis.
const TAKE = `
local key, cost, limit, interval, burst = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local now = redis.call('TIME'); now = now[1] * 1000 + math.floor(now[2] / 1000)
local state = redis.call('HMGET', key, 'tokens', 'at')
local tokens = tonumber(state[1]) or burst
local at = tonumber(state[2]) or now
tokens = math.min(burst, tokens + (now - at) * limit / interval)
local taken = tokens >= cost
if taken then tokens = tokens - cost end
redis.call('HSET', key, 'tokens', tokens, 'at', now)
redis.call('PEXPIRE', key, math.ceil(interval * burst / limit))
if taken then return 0 end
return math.ceil((cost - tokens) * interval / limit)`;

const store = {
  async take(key, cost, { limit, intervalMs, burst }) {
    const waitMs = await redis.eval(TAKE, {
      keys: [`ratelimit:${key}`],
      arguments: [String(cost), String(limit), String(intervalMs), String(burst)],
    });
    return waitMs === 0 ? { taken: true } : { taken: false, waitMs };
  },
};
const limited = new RateLimitTransport(transport, { limit: 14, store });
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
| `maxKeys` | `10000` | The most buckets kept, the least used full one dropped first. |
| `maxQueue` | `10000` | The most messages waiting in one bucket. |
| `store` | | The buckets the processes share, in place of this process's. |
| `now` | `performance.now()` | The clock of the intervals, which no change of the time of day moves. |
| `logger` | | A pino-like logger: a refused send (`ratelimit.limited`) at `info`, a send that waits (`ratelimit.waiting`) and the time it waited (`ratelimit.waited`) at `debug`, buckets dropped before they were full (`ratelimit.evicted`) at `warn`. |

`sendMany()` goes through the `sendMany()` of the wrapped transport, each
message handed to it once it has its tokens, so a batch is throttled like as
many sends; a transport that reads a batch ahead may still send it at once.
`sendRaw()` is throttled as `send()` is, and `verify()` takes no tokens.
