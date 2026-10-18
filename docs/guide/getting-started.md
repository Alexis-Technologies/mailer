# Getting Started

::: tip Status
Version 1.0 is the transport layer, ported from [upyo](https://github.com/dahlia/upyo)
0.7.0; 1.1 adds sendmail, ten more HTTP providers, verified webhooks into delivery
events, and decorators for circuit breaking, rate limits, idempotency, hooks and
mirroring. Unreleased: [the queue](/guide/queue), [templates by name](/messages/templates)
and [the audit](/guide/audit).
:::

## Installation

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

Node.js 22 or newer. The package has no runtime dependencies: every transport is one
package, reached through a subpath (`@alexify/mailer/smtp`), and what a decorator
needs from your application (an OpenTelemetry provider, a logger) is passed in.

### Bun and Deno

The package runs on Bun and Deno through their Node compatibility. CI runs its
tests on Bun 1.4.3 and Deno 2.9.6 (Linux), sending over real sockets, TLS and
`fetch`.

```bash
bun add @alexify/mailer
deno add npm:@alexify/mailer
```

On Deno, import it by its npm name, a subpath included
(`import { SmtpTransport } from 'npm:@alexify/mailer/smtp'`), and grant what the
transports you use need:

- `--allow-net` to send: SMTP, the HTTP providers, JMAP, `fromUrl` and the
  certificates of SNS for `./webhooks`;
- `--allow-read` for `fromPath`;
- `--allow-run` and `--allow-env` for `./sendmail`, as Deno's `child_process`
  passes the environment on;
- `--allow-sys=hostname` for the default EHLO name of `./smtp`; without it, the
  name is `[127.0.0.1]` unless you set `localName`.

Deno's `fetch` sends a request again when a reused connection closes before its
answer, so a message the provider took may go twice, where Node and Bun report it
as of unknown delivery. Give the HTTP transports and JMAP a `fetch` that keeps no
idle connection:

```js
import { PostmarkTransport } from 'npm:@alexify/mailer/postmark';

const client = Deno.createHttpClient({ poolMaxIdlePerHost: 0 });
const fetchOnce = (input, init) => fetch(input, { ...init, client });

const transport = new PostmarkTransport({
  serverToken: Deno.env.get('POSTMARK_TOKEN'),
  fetch: fetchOnce,
});
```

Each request then opens a connection of its own, which costs a handshake; see
[known issues](/guide/known-issues#deno).

## Choosing a transport

Each transport implements the same `Transport` contract of the root entry, so they
can be swapped without changing the code that builds messages:

- [SMTP](/transports/smtp) (`@alexify/mailer/smtp`): universal email protocol, works
  with any SMTP server; DKIM signing, pooling, STARTTLS, DSN, an HTTP CONNECT proxy.
- [Sendmail](/transports/sendmail) (`@alexify/mailer/sendmail`): the sendmail command
  of the system (Postfix, Exim, msmtp).
- [JMAP](/transports/jmap) (`@alexify/mailer/jmap`): RFC 8620/8621 mail servers
  such as Stalwart or Fastmail.
- HTTP providers, one subpath each:
  [Amazon SES](/transports/ses) (`ses`, SES v2 with SigV4),
  [Resend](/transports/resend) (`resend`),
  [SendGrid](/transports/sendgrid) (`sendgrid`),
  [Mailgun](/transports/mailgun) (`mailgun`),
  [Postmark](/transports/postmark) (`postmark`),
  [Brevo](/transports/brevo) (`brevo`),
  [Mailjet](/transports/mailjet) (`mailjet`),
  [MailerSend](/transports/mailersend) (`mailersend`),
  [SparkPost](/transports/sparkpost) (`sparkpost`),
  [Mailtrap](/transports/mailtrap) (`mailtrap`),
  [Maileroo](/transports/maileroo) (`maileroo`),
  [Lettermint](/transports/lettermint) (`lettermint`),
  [ZeptoMail](/transports/zeptomail) (`zeptomail`),
  [SMTP2GO](/transports/smtp2go) (`smtp2go`),
  [Azure Communication Services](/transports/azure) (`azure`),
  [Scaleway](/transports/scaleway) (`scaleway`),
  [Cloudflare](/transports/cloudflare) (`cloudflare`) and
  [Plunk](/transports/plunk) (`plunk`). Each page lists what the provider takes of a
  message: tags, metadata, tracking, a schedule, raw MIME.
- [Mock](/transports/mock) (`@alexify/mailer/mock`): captures emails without
  sending, for tests.

And the decorators, which wrap any transport:

- [Pool](/transports/pool) (`@alexify/mailer/pool`): several transports, picked by
  a strategy, with failover.
- [Retry](/transports/retry) (`@alexify/mailer/retry`): retries with backoff, jitter
  and `Retry-After`.
- [Circuit breaker](/transports/breaker) (`@alexify/mailer/breaker`): stops sending
  to a failing provider, then lets one probe through.
- [Rate limit](/transports/ratelimit) (`@alexify/mailer/ratelimit`): a token bucket
  per key, waiting or refusing.
- [Idempotency](/transports/idempotency) (`@alexify/mailer/idempotency`): a key
  reserved before each send, so a repeat is answered, not sent.
- [Hooks](/transports/hooks) (`@alexify/mailer/hooks`): before and after each send,
  on each retry and error.
- [Tee](/transports/tee) (`@alexify/mailer/tee`): mirrors each message to other
  transports, without waiting for them.
- [OpenTelemetry](/transports/otel) (`@alexify/mailer/otel`): spans and metrics,
  with your providers.
- [Logger](/transports/logger) (`@alexify/mailer/logger`): the delivery lifecycle,
  logged through your pino-like logger.

What happens after a send comes back through the provider's webhooks:
[`@alexify/mailer/webhooks`](/guide/webhooks) verifies them and reads their events
into one model of delivery events.

If none of these fit your needs, you can also
[create a custom transport](/transports/custom).

## Sending your first email

Here's a basic example using Gmail through SMTP:

```js
const { createMessage } = require('@alexify/mailer');
const { SmtpTransport } = require('@alexify/mailer/smtp');

const transport = new SmtpTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // Use TLS
  auth: {
    user: 'your@gmail.com',
    pass: 'your-app-password',
  },
});

const message = createMessage({
  from: 'sender@example.com',
  to: 'recipient@example.net',
  subject: 'Hello from mailer!',
  content: { text: 'This is a test email.' },
});

const receipt = await transport.send(message);
if (receipt.successful) {
  console.log('Message sent with ID:', receipt.messageId);
} else {
  console.error('Send failed:', receipt.errorMessages.join(', '));
}
```

The same names import from ESM:

```js
import { createMessage } from '@alexify/mailer';
import { SmtpTransport } from '@alexify/mailer/smtp';
```

## Your own `fetch` and identifiers

Every transport that makes HTTP requests (the HTTP providers and JMAP) takes a
`fetch` in its configuration, used in place of the global one at each request:
one bound to an undici `Agent` for keep-alive and connection limits, a
`ProxyAgent` for a corporate proxy, mTLS, or an instrumented one. The package
still depends on nothing; undici is yours:

```js
const { Agent, fetch: undiciFetch } = require('undici');
const { ResendTransport } = require('@alexify/mailer/resend');

const dispatcher = new Agent({ connections: 16, keepAliveTimeout: 30_000 });
const transport = new ResendTransport({
  apiKey: process.env.RESEND_API_KEY,
  fetch: (url, init) => undiciFetch(url, { ...init, dispatcher }),
});
```

The JMAP transport streams a raw message whose size it does not know, so its
`fetch` must take a body stream with `duplex: 'half'`, as undici's does.

Every transport also takes a pino-like `logger` for what happens inside it and
its receipts do not tell: the retries of an HTTP request at `debug` (with the
attempt, the wait and the status, never an address), and for SMTP its
connections and protocol (see [diagnostics](/transports/smtp#diagnostics)).
Without one a transport writes nothing, except a `console.warn` for mail sent
without TLS or without the DKIM signature it was asked for.

Every transport also takes `generateId`, which makes the identifiers otherwise
drawn from `crypto.randomUUID()`: a generated Message-ID, an idempotency key,
and the message ID of a receipt the provider gave none for. See
[identifiers of your own](/messages/compose#identifiers-of-your-own).

From here, see [composing messages](/messages/compose) for HTML content, multiple
recipients, threading and List-Unsubscribe, [attachments](/messages/attachments),
[rendering templates](/messages/render) and [calendar invitations](/messages/calendar).

See [Why @alexify/mailer?](/guide/why) for what the library is built to do, and the
[API](/api/exports) for every entry point.

## Several processes

Some parts keep state, and by default they keep it in the process. Several
processes, or a function that makes its transports for each request, each have
their own unless the part is given a store they share:

| Part | What it keeps | In one process | Shared by several |
| --- | --- | --- | --- |
| [`./ratelimit`](/transports/ratelimit) | the token buckets | at most `maxKeys` buckets | a `store` of `take()`, such as a script on Redis, so that N processes send no more than the one limit |
| [`./idempotency`](/transports/idempotency) | the keys reserved and the receipts | `createMemoryIdempotencyStore()` | a store of `reserve`, `complete` and `release`, such as [`createMongoIdempotencyStore()`](/guide/outbox) |
| [`./queue`](/guide/queue) | the jobs | `createMemoryQueue()` | a driver they share: [BullMQ](/transports/bullmq), or the [MongoDB outbox](/guide/outbox) |
| [`./webhooks`](/guide/webhooks#time-and-replays) | the ids of the requests taken | `createMemoryReplayStore()` | a store of `reserve`, `commit` and `release`; required, `null` to keep none |
| [`./breaker`](/transports/breaker) | the state of the circuit | one per transport | none: each process opens its own circuit on the failures it sees |
| [`./pool`](/transports/pool) | the turn of round-robin | one per transport | none |
| [`./smtp`](/transports/smtp) | pooled connections, OAuth 2.0 tokens | one pool per transport | none |

A store of a rate limit or of idempotency that each process makes for itself
gives no more than the memory one: the limit is spent N times over, and a key is
sent once per process.
