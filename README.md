# mailer

[![npm](https://img.shields.io/npm/v/%40alexify%2Fmailer)](https://www.npmjs.com/package/@alexify/mailer)
[![CI](https://github.com/Alexis-Technologies/mailer/actions/workflows/ci.yml/badge.svg)](https://github.com/Alexis-Technologies/mailer/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/%40alexify%2Fmailer)](#installation)
[![dependencies](https://img.shields.io/badge/runtime_dependencies-0-brightgreen)](#why-alexifymailer)
[![docs](https://img.shields.io/badge/docs-online-blue)](https://mailerat.vercel.app/)
[![license](https://img.shields.io/npm/l/%40alexify%2Fmailer)](./LICENSE)

**Email for Node.js, with a reliability layer.** Its own SMTP client, MIME builder, DKIM signing
and HTTP providers, and on top of them what the other libraries leave to the application: a
persistent queue and outbox, an audit log, one model of delivery events, suppression and
idempotency. Zero runtime dependencies.

> 🚧 **Work in progress.** The transport layer is here, ported from
> [upyo](https://github.com/dahlia/upyo) 0.7.0: messages, MIME and DKIM, SMTP, Amazon SES and seven
> more HTTP providers, JMAP, and the pool, retry, OpenTelemetry, logger and mock transports. The
> reliability layer (queue, audit log, delivery events) is being designed.

### 📖 [Read the documentation →](https://mailerat.vercel.app/)

## Why @alexify/mailer

- **Its own transport.** An SMTP client (pool, STARTTLS, PIPELINING, DSN, SMTPUTF8, OAuth 2.0), a
  MIME builder and DKIM (RSA-SHA256, Ed25519), and HTTP providers on `fetch`: Amazon SES v2,
  Resend, SendGrid, Mailgun, Mailtrap, Maileroo, Lettermint, Plunk, and JMAP. Secure by default:
  TLS certificates are verified, AUTH never goes over plain text, CRLF in a header is rejected.
- **What happens after `send()`** (being designed). A persistent queue and outbox, an append-only
  audit log and one model of delivery events (delivered, bounced, complained, failed). None of the
  [fourteen libraries compared](https://mailerat.vercel.app/guide/comparison) has the three.
- **Sent once, or known to be unknown.** Errors are classified as permanent or temporary, and a
  failure after which the provider may have taken the message is marked `deliveryUnknown`:
  `./retry` and `./pool` never send it again. Idempotency keys with deduplication come with the
  outbox.
- **Correct before broad.** The tests read the composed messages back with an independent parser;
  golden `.eml` messages, DKIM checked by an independent verifier and fuzzing of headers,
  `multipart/related`, dot-stuffing and internationalized addresses are planned.
- **Zero dependencies.** Built on `node:*` modules and `fetch`. What a part needs from your
  application is passed in: the OpenTelemetry providers, a pino-like logger, and later the driver of
  a queue or a database (BullMQ, MongoDB). CommonJS with ESM named imports and hand-written
  TypeScript typings, no build step.

## Installation

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

Requires Node.js 22 or newer.

## Usage

The root entry builds messages; each transport is a subpath of the same package:

```js
const { createMessage } = require('@alexify/mailer');
const { SmtpTransport } = require('@alexify/mailer/smtp');

const transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 587,
  auth: { user: 'user@example.com', pass: 'secret' },
});

const receipt = await transport.send(
  createMessage({
    from: 'Alex <alex@example.com>',
    to: 'bob@example.net',
    subject: 'Hello',
    content: { text: 'Hi there.', html: '<p>Hi there.</p>' },
  }),
);
if (!receipt.successful) console.error(receipt.errorMessages);
```

| Subpath | What it is |
| --- | --- |
| `@alexify/mailer` | messages, attachments, calendar parts, the `Transport` contract, receipts |
| `/mime` | MIME composition and DKIM signing |
| `/smtp`, `/jmap` | SMTP and JMAP transports |
| `/ses`, `/resend`, `/sendgrid`, `/mailgun`, `/mailtrap`, `/maileroo`, `/lettermint`, `/plunk` | HTTP providers |
| `/pool`, `/retry`, `/otel`, `/logger` | decorators: failover, retries, OpenTelemetry, logging |
| `/mock` | an in-memory transport for tests |

The same names import from ESM (`import { SmtpTransport } from '@alexify/mailer/smtp'`). The
[API reference](https://mailerat.vercel.app/api/exports) lists every member, and the
[guide](https://mailerat.vercel.app/guide/getting-started) every transport.

## Compared with alternatives

The [comparison](https://mailerat.vercel.app/guide/comparison) puts Nodemailer, emailjs, Upyo,
unemail, sently, worker-mailer, edge-mailer, MIMEText and the SDKs of Resend, SendGrid, Mailgun,
Postmark, Mailtrap and Amazon SES side by side, feature by feature, from their source code.

## Credits

The transport layer is a port of [upyo](https://github.com/dahlia/upyo) 0.7.0 by Hong Minhee
(MIT), converted to CommonJS with hand-written types and no dependencies; its notice is in
[LICENSE](./LICENSE).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE) © Alexis Technologies
