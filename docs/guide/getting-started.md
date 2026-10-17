# Getting Started

::: tip Status
Version 1.0 is the transport layer, ported from [upyo](https://github.com/dahlia/upyo)
0.7.0: messages, SMTP, eight HTTP providers, JMAP and the decorators. The reliability
layer (queue, audit log, delivery events) is still being designed.
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

## Choosing a transport

Each transport implements the same `Transport` contract of the root entry, so they
can be swapped without changing the code that builds messages:

- [SMTP](/transports/smtp) (`@alexify/mailer/smtp`): universal email protocol, works
  with any SMTP server; DKIM signing, pooling, STARTTLS, DSN.
- [Amazon SES](/transports/ses) (`@alexify/mailer/ses`): cost-effective email
  service for AWS users.
- [Resend](/transports/resend) (`@alexify/mailer/resend`): developer-friendly API,
  batch sending.
- [SendGrid](/transports/sendgrid) (`@alexify/mailer/sendgrid`): popular email API
  with a deliverability focus.
- [Mailgun](/transports/mailgun) (`@alexify/mailer/mailgun`): HTTP API with US and
  EU regions.
- [Mailtrap](/transports/mailtrap) (`@alexify/mailer/mailtrap`): Email API and Email
  Sandbox for production delivery and test inbox capture.
- [Maileroo](/transports/maileroo) (`@alexify/mailer/maileroo`): JSON email API with
  attachments, tags, custom headers and tracking.
- [Lettermint](/transports/lettermint) (`@alexify/mailer/lettermint`): transactional
  email API with routes, metadata, idempotency and batch sending.
- [Plunk](/transports/plunk) (`@alexify/mailer/plunk`): cloud or self-hosted
  transactional email.
- [JMAP](/transports/jmap) (`@alexify/mailer/jmap`): RFC 8620/8621 mail servers
  such as Stalwart or Fastmail.
- [Mock](/transports/mock) (`@alexify/mailer/mock`): captures emails without
  sending, for tests.

And the decorators, which wrap any transport:

- [Pool](/transports/pool) (`@alexify/mailer/pool`): several transports, picked by
  a strategy, with failover.
- [Retry](/transports/retry) (`@alexify/mailer/retry`): retries with backoff, jitter
  and `Retry-After`.
- [OpenTelemetry](/transports/otel) (`@alexify/mailer/otel`): spans and metrics,
  with your providers.
- [Logger](/transports/logger) (`@alexify/mailer/logger`): the delivery lifecycle,
  logged through your pino-like logger.

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

The JMAP transport streams its raw uploads, so its `fetch` must take a body
stream with `duplex: 'half'`, as undici's does.

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
recipients and threading, [attachments](/messages/attachments), and
[calendar invitations](/messages/calendar).

See [Why @alexify/mailer?](/guide/why) for what the library is built to do, and the
[API](/api/exports) for every entry point.
