# Logger transport

The logger transport records email delivery lifecycle events as structured logs,
through a logger the application passes in: a [pino] logger, a child of one, or
anything with a method per level that takes the properties first and the message
second (`logger.info(properties, message)`). It can be used by itself during local
development, where no message is actually delivered, or as a decorator around
another transport. In decorator mode, the wrapped transport still performs delivery
and its receipts and errors pass through unchanged.

@alexify/mailer does not create or configure a logger, and requires none: the
application keeps its destinations, redaction and levels.

The transport is the `./logger` subpath, adapted from the LogTape transport of
[upyo](https://github.com/dahlia/upyo).

[pino]: https://getpino.io/

## Installation

```bash
pnpm add @alexify/mailer pino
# or
npm install @alexify/mailer pino
```

Any pino-like logger works; pino is only the example here.

## Log-only usage

With no wrapped transport, `LoggerTransport` records the send and returns a
synthetic successful receipt. This is useful for exercising email workflows without
sending real messages:

```js
const pino = require('pino');
const { createMessage } = require('@alexify/mailer');
const { LoggerTransport } = require('@alexify/mailer/logger');

const logger = pino({ level: 'debug' });
const transport = new LoggerTransport({ logger });
const message = createMessage({
  from: 'sender@example.com',
  to: 'recipient@example.net',
  subject: 'Welcome',
  content: { text: 'Welcome to our service.' },
});

const receipt = await transport.send(message);
if (receipt.successful) {
  console.log(receipt.messageId); // "logger-..."
}
```

A log-only receipt uses the provider id `"logger"` and a generated message id, but
it does not imply that an email was delivered outside the application.

A log-only transport returns a receipt whose message ID is `logger-` and a UUID,
or what `generateId` makes when it is given.

## Decorating another transport

Pass another transport through the `transport` option to add logs around real
delivery:

```js
const pino = require('pino');
const { LoggerTransport } = require('@alexify/mailer/logger');
const { SmtpTransport } = require('@alexify/mailer/smtp');

const smtp = new SmtpTransport({
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  auth: {
    user: 'smtp-user@example.com',
    pass: 'smtp-password',
  },
});

const transport = new LoggerTransport({
  transport: smtp,
  logger: pino().child({ component: 'outbound-email' }),
});
```

The decorator preserves the wrapped provider id, forwards `AbortSignal`, uses the
wrapped `sendMany()` implementation, and passes successful and failed receipts
through unchanged. Exceptions are logged under `err`, the key pino serializes with
its type, message and stack, and then rethrown. Explicit disposal is also forwarded
to disposable wrapped transports. Completion logs are emitted as callers consume
receipts. If a caller stops reading a batch early, the wrapped iterator is closed
without being drained so the logging layer does not start additional delivery work.

In `sendMany()`, the decorator keeps each message it has passed on until its
receipt comes back, to log the two together.  It holds as many as the wrapped
transport reads ahead of its receipts and no more: one for the providers that
send one message at a time, `concurrency` for those that take it, a batch for
SES, Resend, Mailtrap, Lettermint and JMAP, and at most twice `maxConcurrent`
for a `./retry` inside it.

A logger that throws changes nothing of the delivery: the message is still sent,
its receipt still comes back, and the failure is emitted as a process warning
with the code `MAILER_LOGGER_FAILED` (`process.on('warning', …)`), since losing
the receipt could make the caller send the message again.

The retries of the wrapped transport, those an HTTP provider makes on its own and
those of a `./retry` inside the logger transport, are logged as `email.retrying`
events, with the attempt that failed, the wait in milliseconds, the text of the
error (its addresses replaced by `[REDACTED]` unless the message is recorded)
and its `statusCode` when it has one. They come from `onRetry` of the send
options, which still reaches a callback of your own.

The logger transport can be nested with retry, pool, and OpenTelemetry transports.
The outer decorator observes the complete operation performed by the inner
transport, so choose the order according to which retries or failovers should
appear as one logged operation.

## Levels

The lifecycle levels can be changed independently, by pino's level names
(`trace`, `debug`, `info`, `warn`, `error`, `fatal`):

```js
const { LoggerTransport } = require('@alexify/mailer/logger');

const transport = new LoggerTransport({
  logger,
  levels: {
    sending: 'trace',
    sent: 'info',
    failed: 'fatal',
  },
});
```

- `sending`: Level for `email.sending` events. Defaults to `"debug"`.
- `sent`: Level for `email.sent` events. Defaults to `"info"`.
- `failed`: Level for failed receipts and thrown errors. Defaults to `"error"`.
- `retrying`: Level for `email.retrying` events. Defaults to `"warn"`.

The transport checks when it is made that the logger has a method for each of these
levels, that of `retrying` only when it wraps a transport, and throws a
`TypeError` otherwise.

Every event includes the operation, transport id, recipient counts, attachment
count, and priority. Completion events additionally include duration and receipt or
error details. Instead of a category, give the transport a child logger with the
bindings you want (`logger.child({ component: 'mail' })`).

## Recording message content

Messages are excluded from logs by default, and so are the addresses that the
error text of a failure names: with `recordMessage` off, `errorMessages`,
`errors` and `receipt` are logged with every address replaced by `[REDACTED]`
(`RCPT TO failed for [REDACTED]: 550 No such user`), and without the
provider's raw response (`providerDetails`). The `recordMessage` option has two
modes, both of which log the failure as it is:

- `"properties"`: Adds the complete `Message` object to the structured properties
  of every lifecycle event. The log message itself remains on one line.
- `"inline"`: Adds the same `message` property and renders the subject and body
  beneath the lifecycle message. This format is convenient when reading local
  development logs.

Use `"properties"` when a destination will process the message as structured data:

```js
const transport = new LoggerTransport({ logger, recordMessage: 'properties' });
```

Use `"inline"` to include the subject and body in the log message:

```js
const transport = new LoggerTransport({ logger, recordMessage: 'inline' });
```

Inline mode uses plain text whenever the `text` property is defined, even when it
is an empty string. If no plain-text body is defined, it uses the HTML body. The
text is built by the transport, since a pino-like logger interpolates no template.
Lifecycle errors without an associated message stay on one line.

> [!CAUTION]
> Both modes expose complete messages. These can contain personal addresses,
> subjects, email bodies, custom headers, and large attachment data. Enable either
> mode only for destinations with suitable access controls, or with pino's
> [redaction].

[redaction]: https://getpino.io/#/docs/redaction

## Internal diagnostics

The decorator sees a send from the outside: it starts, it is retried, it ends
with a receipt. What happens inside a transport is told by the `logger` option
of the transport itself, which every transport and decorator takes:

```js
const pino = require('pino');
const { SmtpTransport } = require('@alexify/mailer/smtp');
const { LoggerTransport } = require('@alexify/mailer/logger');

const logger = pino({ level: 'debug' }).child({ component: 'mail' });

const transport = new LoggerTransport({
  // The lifecycle of each send.
  logger,
  // The connections, STARTTLS, authentication and pool of SMTP.
  transport: new SmtpTransport({ host: 'smtp.example.com', logger }),
});
```

A transport binds its records to itself through `logger.child({ transport })`
when the logger has `child`, and builds a record only for a level the logger
writes (`isLevelEnabled`). It writes `debug` for its lifecycle and retries,
`trace` for the SMTP protocol, and `warn` for a degradation: mail sent in plain
text (`MAILER_SMTP_PLAINTEXT`), a DKIM signature skipped under `send-unsigned`
(`MAILER_DKIM_UNSIGNED`), a pool selector that throws. It never writes a
credential or an address, nor the failure of a message, which its receipt
already carries. Without a logger it writes nothing but the two warnings of
mail sent with less protection than asked, to `console.warn`; and a logger that
throws changes nothing of a send, its failure being emitted as a process warning
with the code `MAILER_LOGGER_FAILED`.
