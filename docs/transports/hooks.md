# Hooks

`HooksTransport` calls functions of the application around each send of a
transport: before it, after it, on a retry and on a thrown error. It comes from
the hooks of sently.

## Basic usage

```js
const { HooksTransport } = require('@alexify/mailer/hooks');

const transport = new HooksTransport(ses, {
  beforeSend: async (message) => {
    if (await suppression.has(message.recipients[0].address)) {
      throw new Error('on the suppression list');
    }
  },
  afterSend: async (receipt, message, context) => {
    await audit.record({ receipt, subject: message.subject, at: context.startedAt });
  },
  onRetry: (event, context) => metrics.increment('email.retry', { op: context.operation }),
});
```

## The hooks

The `context` of a hook holds the `transportId`, the `operation`, when the send
began (`startedAt`) and the caller's `signal`, for a hook that waits on something
to heed it; an abort while `beforeSend` runs sends nothing.


| Hook | Called | When it throws |
| --- | --- | --- |
| `beforeSend(message, context)` | before a message is sent; it may return a message of `createMessage` to send in its place (anything else refuses it) | the message is not sent; its receipt is `rejected` (code `hooks.refused`), not retryable |
| `beforeSendRaw(raw, context)` | before a raw message is sent, the same way | the same |
| `afterSend(receipt, message, context)` | after every send, its receipt successful or not | a process warning (`MAILER_HOOK_FAILED`); the receipt stands |
| `onRetry(event, context)` | before each retry of the wrapped transport, or of a `./retry` inside it, not awaited | a process warning, a promise that rejects too |
| `onError(error, message, context)` | when the wrapped transport throws, before the error goes on | a process warning; the error goes on |

A hook may be async; it is awaited. The context, `{ transportId, operation,
startedAt }`, is made for each send, and `onRetry` goes in the options of that
send, so concurrent sends never hear each other's retries; the caller's own
`onRetry` still hears them all. `startedAt` comes from the clock `now`
(`Date.now` by default).

`sendMany()` goes through the `sendMany()` of the wrapped transport, each
message between its hooks, one `beforeSend` refuses answered in place; its
`onRetry` hears the retries with the context of the batch.
