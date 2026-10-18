# Tee

`TeeTransport` sends each message through a primary transport and mirrors it
to others: to shadow a new provider against the one in use, or to copy real mail
into a local catcher while developing. The primary's receipt is the one
returned, whatever the mirrors do. It comes from the tee driver of unemail.

## Basic usage

```js
const { TeeTransport } = require('@alexify/mailer/tee');

const transport = new TeeTransport(ses, {
  mirrors: [postmark],
  onMirror: ({ mirror, receipt, error, skipped }) =>
    metrics.record('shadow', { mirror, ok: receipt?.successful === true, error, skipped }),
});
```

## Mirrors never hold the primary

Each mirror's send has a timeout of its own (`timeout`, 10 seconds), which ends
it whether or not the mirror heeds its signal, and by default it is not
awaited: the primary's receipt comes back as soon as the
primary answers, and the copies go on alone, not stopped by the caller's
signal. At most `maxPending` copies are in flight; one over that is skipped and
reported. On a runtime that freezes after the response, such as a serverless
function, set `awaitMirrors`: the copies are then awaited, bounded by the
timeout, and follow the caller's signal. Disposing of the tee waits for the
copies in flight before it disposes of the mirrors. The primary and the mirrors
send one Message-ID, so a copy reads as the message it is.

The copies start with the primary's send, not after it: a mirror receives the
message whether or not the primary takes it, so a copy may go out for a
message the primary refused. A shadow that should see only what the primary
sent belongs after the send, in `afterSend` of [`./hooks`](/transports/hooks).

`onMirror` hears the outcome of every copy: its `receipt`, the `error` its send
threw, or why it was `skipped`. Without it, a failed or skipped copy becomes a
process warning (`MAILER_TEE_MIRROR_FAILED`), with the addresses of its text
redacted, and no more than ten a minute: the first after a minute says how many
were left out.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `mirrors` | (required) | The transports each message is mirrored to. |
| `timeout` | `10000` | The time a mirror's send may take, in milliseconds. |
| `awaitMirrors` | `false` | Waits for the copies before returning. |
| `maxPending` | `100` | The most copies in flight while not awaited. |
| `onMirror` | | Hears every outcome of a mirror. |
| `logger` | | A pino-like logger: without `onMirror`, a failed copy at `warn`, in place of a process warning. |

`sendMany()` goes through the `sendMany()` of the primary, each message mirrored
as it is handed to it. `sendRaw()` mirrors to the mirrors that send raw
messages and reports the others as skipped. `verify()` checks the primary
alone, and disposal disposes of the primary and every mirror once.
