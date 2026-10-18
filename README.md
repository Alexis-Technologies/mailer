# mailer

[![npm](https://img.shields.io/npm/v/%40alexify%2Fmailer)](https://www.npmjs.com/package/@alexify/mailer)
[![CI](https://github.com/Alexis-Technologies/mailer/actions/workflows/ci.yml/badge.svg)](https://github.com/Alexis-Technologies/mailer/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/%40alexify%2Fmailer)](#installation)
[![dependencies](https://img.shields.io/badge/runtime_dependencies-0-brightgreen)](#why-alexifymailer)
[![docs](https://img.shields.io/badge/docs-online-blue)](https://mailerat.vercel.app/)
[![license](https://img.shields.io/npm/l/%40alexify%2Fmailer)](./LICENSE)

**Email for Node.js, with a reliability layer.** Its own SMTP client, MIME builder, DKIM signing
and eighteen HTTP providers, and on top of them what the other libraries leave to the
application: one model of delivery events, idempotency, and next a persistent queue and outbox, an
audit log and suppression. Zero runtime dependencies.

> **Status: 1.1 is the transport layer and the first parts of the reliability layer.** 1.0 ported
> the transport from [upyo](https://github.com/dahlia/upyo) 0.7.0; 1.1 adds what
> [nodemailer](https://github.com/nodemailer/nodemailer),
> [unemail](https://github.com/productdevbook/unemail) and
> [sently](https://github.com/omqkhafi/sently) did better: sendmail, ten more HTTP providers,
> attachments from paths and URLs, one-click List-Unsubscribe, verified webhooks into one model of
> delivery events, and decorators for circuit breaking, rate limits, idempotency, hooks and
> mirroring. The persistent queue, the audit log and suppression are being designed.

### 📖 [Read the documentation →](https://mailerat.vercel.app/)

## Why @alexify/mailer

- **Its own transport.** An SMTP client (pool, STARTTLS, PIPELINING, DSN, SMTPUTF8, OAuth 2.0, an
  HTTP CONNECT proxy or any socket you connect), sendmail, a MIME builder (IDN domains as
  punycode, 7bit, quoted-printable or base64 by content) and DKIM (RSA-SHA256, Ed25519), JMAP, and
  eighteen HTTP providers on `fetch`: Amazon SES v2, Resend, SendGrid, Mailgun, Postmark, Brevo,
  Mailjet, MailerSend, SparkPost, Mailtrap, Maileroo, Lettermint, ZeptoMail, SMTP2GO, Azure
  Communication Services, Scaleway, Cloudflare and Plunk. Secure by default: TLS certificates are
  verified, AUTH never goes over plain text, CRLF in a header is rejected, and no file or URL is
  read for an attachment unless you ask.
- **What happens after `send()`.** The webhooks of fifteen providers, each verified before it is
  read and taken as handled only once your handler commits it, give one model of delivery events
  (delivered, bounced, complained, …). Next: a persistent queue and outbox, an append-only audit
  log and suppression. None of the
  [fourteen libraries compared](https://mailerat.vercel.app/guide/comparison) has the three.
- **Sent once, or known to be unknown.** Errors are classified as permanent or temporary, and a
  failure after which the provider may have taken the message is marked `deliveryUnknown`:
  `./retry` and `./pool` never send it again. `./idempotency` reserves a key before the send,
  `./breaker` lets one probe through a failing provider, and `./ratelimit` keeps to its quota.
- **Correct before broad.** The tests read the composed messages back with an independent parser
  and check DKIM with an independent verifier, and the suites run on Node 22 and 24, Bun and Deno;
  golden `.eml` messages and fuzzing of headers, `multipart/related`, dot-stuffing and
  internationalized addresses are planned.
- **Zero dependencies.** Built on `node:*` modules and `fetch`. What a part needs from your
  application is passed in: the OpenTelemetry providers, a pino-like logger, the `render` of React
  Email, and later the driver of a queue or a database (BullMQ, MongoDB). CommonJS with ESM named
  imports and hand-written TypeScript typings, no build step.

## Installation

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

Requires Node.js 22 or newer. Bun and Deno run it too, tested in CI; on Deno, see
[Bun and Deno](https://mailerat.vercel.app/guide/getting-started#bun-and-deno) for the
permissions and the `fetch` to pass.

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
| `@alexify/mailer` | messages, attachments, calendar parts, the `Transport` contract, receipts, delivery events |
| `/mime` | MIME composition and DKIM signing |
| `/attachments`, `/render` | attachments from a path, a URL, a data URI or a stream; templates and React Email |
| `/smtp`, `/sendmail`, `/jmap` | SMTP, sendmail and JMAP transports |
| `/ses`, `/resend`, `/sendgrid`, `/mailgun`, `/postmark`, `/brevo`, `/mailjet`, `/mailersend`, `/sparkpost`, `/mailtrap`, `/maileroo`, `/lettermint`, `/zeptomail`, `/smtp2go`, `/azure`, `/scaleway`, `/cloudflare`, `/plunk` | HTTP providers |
| `/webhooks` | verified webhooks of fifteen providers, read into delivery events |
| `/pool`, `/retry`, `/breaker`, `/ratelimit`, `/idempotency`, `/hooks`, `/tee`, `/otel`, `/logger` | decorators: failover, retries, circuit breaking, rate limits, idempotency, hooks, mirroring, OpenTelemetry, logging |
| `/mock` | an in-memory transport for tests |

Every transport takes `generateId` for the identifiers it makes (a ULID or a cuid2 instead of a
UUID) and a pino-like `logger` for what happens inside it, and every HTTP transport a `fetch`,
such as one bound to an undici `Agent` or a proxy; see
[your own fetch and identifiers](https://mailerat.vercel.app/guide/getting-started#your-own-fetch-and-identifiers).

The same names import from ESM (`import { SmtpTransport } from '@alexify/mailer/smtp'`). The
[API reference](https://mailerat.vercel.app/api/exports) lists every member, and the
[guide](https://mailerat.vercel.app/guide/getting-started) every transport.

## Compared with alternatives

The [comparison](https://mailerat.vercel.app/guide/comparison) puts Nodemailer, emailjs, Upyo,
unemail, sently, worker-mailer, edge-mailer, MIMEText and the SDKs of Resend, SendGrid, Mailgun,
Postmark, Mailtrap and Amazon SES side by side, feature by feature, from their source code.

## Credits

The transport layer is a port of [upyo](https://github.com/dahlia/upyo) 0.7.0 by Hong Minhee
(MIT), converted to CommonJS with hand-written types and no dependencies. Features of 1.1 are
ported from [nodemailer](https://github.com/nodemailer/nodemailer) 10.0.16 by Andris Reinman
(MIT-0), [unemail](https://github.com/productdevbook/unemail) 0.7.0 (MIT) and
[sently](https://github.com/omqkhafi/sently) 1.2.2 (MIT), with their known bugs fixed in the port.
Their notices are in [LICENSE](./LICENSE).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE) © Alexis Technologies
