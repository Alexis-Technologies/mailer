# Retry transport

The retry transport is a decorator that wraps another @alexify/mailer transport and
retries transient delivery failures before returning a final receipt.  It is
useful when a single provider occasionally returns rate limits, temporary
server errors, or network failures that should be retried with backoff.

Retrying depends on structured failure metadata from *@alexify/mailer*.  Transports
that return failed receipts with `retryable` or structured `errors` fields can
be retried without custom logic.  Cancellation via `AbortSignal` is never
retried and still rejects the send operation.

> [!NOTE]
> Retry transport is not a cross-provider failover system.  To fail over across
> several providers, use [pool transport](/transports/pool), and place retry transport
> inside or outside the pool depending on whether you want per-provider retries
> or retries of the whole pooled operation.

## Installation

To use retry transport, install the *@alexify/mailer/retry* subpath:

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

## Basic usage

Create your regular transport first, then wrap it with `RetryTransport`.
The wrapper implements the same `Transport` interface and keeps the wrapped
transport provider id in receipts:

```js
const { createFailedReceipt, createMessage } = require('@alexify/mailer');
const { MockTransport } = require('@alexify/mailer/mock');
const { RetryTransport } = require('@alexify/mailer/retry');

const baseTransport = new MockTransport({
  defaultResponse: createFailedReceipt('Temporarily unavailable.', {
    provider: 'mock',
    statusCode: 503,
  }),
});

const transport = new RetryTransport(baseTransport, {
  maxAttempts: 3,
  backoff: {
    baseDelayMilliseconds: 1000,
    maxDelayMilliseconds: 30000,
    factor: 2,
  },
});

const message = createMessage({
  from: 'sender@example.com',
  to: 'recipient@example.com',
  subject: 'Hello',
  content: { text: 'Hello from mailer.' },
});

const receipt = await transport.send(message);

if (!receipt.successful) {
  console.error(receipt.errorMessages.join(', '));
  console.error('Attempts:', receipt.attempts);
}
```

By default, retry transport makes up to three total attempts, waits with
exponential backoff, caps computed delays at 30 seconds, and applies full
jitter to computed backoff delays.

## Retry classification

Retry transport uses the final failed receipt from each attempt to decide
whether another attempt should be made.  It retries when the receipt or one of
its structured errors is marked retryable.  This includes common transient
HTTP statuses such as `429`, `408`, and `5xx` when transports expose them as
structured receipt errors.

A receipt whose delivery is unknown (`receipt.deliveryUnknown`) is not
retried: the message may have been accepted before the timeout or the lost
connection, and another attempt could deliver it twice.  Every attempt carries
the same `Message-ID`, generated before the first one when the message has
none, so that a duplicate can be told apart.

If a wrapped transport throws a transient error instead of returning a failed
receipt, retry transport retries it using the same classifier used by
*@alexify/mailer*.  After all attempts are exhausted, thrown delivery failures are
converted into a failed receipt.  Caller cancellation errors are rethrown.

You can override classification with `shouldRetry` when a provider needs
application-specific logic:

```js
const { MockTransport } = require('@alexify/mailer/mock');
const { RetryTransport } = require('@alexify/mailer/retry');

const baseTransport = new MockTransport();

const transport = new RetryTransport(baseTransport, {
  shouldRetry(failure) {
    if (failure.kind === 'receipt') {
      return failure.receipt.errorMessages.some((message) => message.includes('temporary'));
    }
    return failure.error instanceof TypeError;
  },
});
```

## Backoff and `Retry-After`

Computed retry delays use exponential backoff:

- `baseDelayMilliseconds * factor ^ (attempt - 1)`: The delay before the next attempt, capped by `maxDelayMilliseconds`.

- `jitter`: `"full"` by default.  Set it to `false` or `"none"` for deterministic
  computed delays.

- `Retry-After`: When a structured receipt error includes `retryAfterMilliseconds`, retry
  transport uses that provider-supplied delay before computed backoff.  When it
  is longer than `maxDelayMilliseconds`, the transport does not retry sooner,
  where the provider would most likely refuse again: it returns the failed
  receipt at once, with its delay, for the caller or a queue to schedule.

Tests or host environments can replace waiting by passing a custom `wait`
function:

```js
const { MockTransport } = require('@alexify/mailer/mock');
const { RetryTransport } = require('@alexify/mailer/retry');

const delays = [];
const baseTransport = new MockTransport();

const transport = new RetryTransport(baseTransport, {
  jitter: false,
  wait(context, signal) {
    signal?.throwIfAborted();
    delays.push(context.delayMilliseconds);
    return Promise.resolve();
  },
});
```

## `sendMany()` throttling

`sendMany()` retries each message independently by calling the wrapped
transport's `send()` method for each input message.  This means provider-native
batch APIs are not used through retry transport.  Use the provider transport
directly when its batch API semantics matter more than per-message retry.

For bulk sends, configure `maxConcurrent` and `intervalMilliseconds` to limit
how aggressively messages are launched:

```js
const { createMessage } = require('@alexify/mailer');
const { MockTransport } = require('@alexify/mailer/mock');
const { RetryTransport } = require('@alexify/mailer/retry');

const baseTransport = new MockTransport();
const transport = new RetryTransport(baseTransport, {
  maxAttempts: 3,
  sendMany: {
    maxConcurrent: 4,
    intervalMilliseconds: 250,
  },
});

const messages = [
  createMessage({
    from: "sender@example.com",
    to: "one@example.com",
    subject: "One",
    content: { text: "First message." },
  }),
  createMessage({
    from: "sender@example.com",
    to: "two@example.com",
    subject: "Two",
    content: { text: "Second message." },
  }),
];

for await (const receipt of transport.sendMany(messages)) {
  console.log(receipt.successful);
}
```

Receipts are yielded in the same order as input messages, even when later
messages finish first.

## Observing retries

Pass `onRetry` in the options of a send to hear of every retry before its wait:
those of `RetryTransport` and, since it passes the options on, those that an
HTTP provider makes on its own (`retries`).  The event carries the attempt that
failed, from 1, the wait in milliseconds and the error behind it: the error of
the request for a provider, the error a send threw or the first `ReceiptError`
of its receipt for `RetryTransport`.

```js
const receipt = await transport.send(message, {
  onRetry: ({ attempt, delayMilliseconds, error }) => {
    console.warn(`Attempt ${attempt} failed, retrying in ${delayMilliseconds} ms`, error);
  },
});
```

An error thrown by the callback rejects the send. `./otel` records these retries
on its span and in its metrics, and the JMAP transport does not report its own
yet.

## Composition

Retry transport composes with other decorators because it preserves the
standard @alexify/mailer transport interface.  Put it closest to the provider when you
want provider-level retries before another decorator observes or aggregates
the result:

```js
const { MockTransport } = require('@alexify/mailer/mock');
const { createRetryTransport } = require('@alexify/mailer/retry');

const providerTransport = new MockTransport();
const transport = createRetryTransport(providerTransport, {
  maxAttempts: 4,
});
```

When wrapping disposable transports, `RetryTransport` forwards async disposal
to the wrapped transport.  If the wrapped transport only supports synchronous
disposal, that is used as a fallback.
