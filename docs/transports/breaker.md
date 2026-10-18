# Circuit breaker

`CircuitBreakerTransport` stops sending through a transport that keeps failing,
answers at once while it is down, and lets one probe through to learn whether it
is back. It comes from the circuit breaker of unemail.

## Basic usage

```js
const { CircuitBreakerTransport } = require('@alexify/mailer/breaker');
const { SesTransport } = require('@alexify/mailer/ses');

const transport = new CircuitBreakerTransport(new SesTransport(sesConfig), {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  onStateChange: (state, previous) => console.log(`SES circuit ${previous} -> ${state}`),
});
```

## States

- **closed:** every send goes through. A failed receipt counts when one of its
  errors is of the category `network`, `timeout`, `server-error` or
  `service-unavailable`, and so does a thrown error other than the caller's
  abort. A message the provider refused, a rate limit or a success answers
  that the provider is up, and starts the count again.
- **open:** after `failureThreshold` failures in a row. A send is answered at
  once, nothing sent, with a retryable `service-unavailable` receipt (code
  `breaker.open`) whose `retryAfterMilliseconds` is the time left.
- **half-open:** after `resetTimeoutMs`. One send goes through as a probe; the
  others are answered as while open until it ends. Its success closes the
  circuit, its failure opens it again, and so does a probe that has not
  answered within `probeTimeoutMs`. A probe the caller aborts, or that a batch
  is left with when its caller stops reading, decides nothing.

A result counts only in the period of the circuit it was sent in: a late one of
a send made before the circuit opened, or before it closed again, changes
nothing. A batch whose `sendMany()` throws is one failure, not one per message. The state is that of the instance;
`breaker.state` reads it.

## With a pool and retries

The receipt of an open circuit is one `./pool` fails over with and `./retry`
waits for, so a breaker around each provider of a pool takes a failing one out
of the rotation until its probe succeeds:

```js
const { PoolTransport } = require('@alexify/mailer/pool');

const pool = new PoolTransport({
  transports: [
    { transport: new CircuitBreakerTransport(ses), priority: 1 },
    { transport: new CircuitBreakerTransport(postmark), priority: 2 },
  ],
  strategy: 'priority',
});
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `failureThreshold` | `5` | The failures in a row that open the circuit. |
| `resetTimeoutMs` | `30000` | How long it stays open before a probe. |
| `probeTimeoutMs` | `resetTimeoutMs` | How long a probe may take before it counts as a failure. |
| `isFailure` | the categories above | Whether a receipt counts as a failure. |
| `onStateChange` | | Hears each change of state; one that throws becomes a process warning (`MAILER_BREAKER_LISTENER_FAILED`). |
| `now` | `Date.now` | The clock. |
| `logger` | | A pino-like logger: a change of state (`breaker.open` at `warn`, `breaker.half-open` and `breaker.closed` at `info`), a refused send (`breaker.refused`) at `debug`. |

`sendMany()` goes through the `sendMany()` of the wrapped transport while the
circuit is closed, so its batching is kept; a message read while it is open is
answered in place, the receipts in the order of the messages. `sendRaw()` is
guarded as `send()` is, and `verify()` goes through whatever the state.
