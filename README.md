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

> 🚧 **Work in progress.** The API is being designed. `createMailer` is exported today as a
> placeholder that throws.

### 📖 [Read the documentation →](https://mailerat.vercel.app/)

## Why @alexify/mailer

- **Its own transport.** An SMTP client, a MIME builder and DKIM written for this library, and
  HTTP providers on `fetch`, starting with Amazon SES v2. Secure by default: TLS certificates are
  verified, AUTH never goes over plain text, CRLF in a header is rejected.
- **What happens after `send()`.** A persistent queue and outbox, an append-only audit log and one
  model of delivery events (delivered, bounced, complained, failed). None of the
  [fourteen libraries compared](https://mailerat.vercel.app/guide/comparison) has the three.
- **Sent once, or known to be unknown.** Idempotency keys with deduplication, errors classified as
  permanent or temporary, and a `delivery_unknown` state instead of a blind retry when a provider
  has no idempotency key.
- **Correct before broad.** Golden `.eml` messages, DKIM checked by an independent verifier, and
  fuzzing of headers, `multipart/related`, dot-stuffing and internationalized addresses.
- **Zero dependencies.** Built on `node:*` modules and `fetch`. The driver of a queue or a database
  (BullMQ, MongoDB) is created by your application and passed in. CommonJS with ESM named imports
  and hand-written TypeScript typings, no build step.

## Installation

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

Requires Node.js 22 or newer.

## Exports

```js
const { createMailer } = require('@alexify/mailer');
```

```js
import { createMailer } from '@alexify/mailer';
```

The [API reference](https://mailerat.vercel.app/api/exports) lists every member.

## Compared with alternatives

The [comparison](https://mailerat.vercel.app/guide/comparison) puts Nodemailer, emailjs, Upyo,
unemail, sently, worker-mailer, edge-mailer, MIMEText and the SDKs of Resend, SendGrid, Mailgun,
Postmark, Mailtrap and Amazon SES side by side, feature by feature, from their source code.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE) © Alexis Technologies
