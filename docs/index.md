---
layout: home

title: '@alexify/mailer'
titleTemplate: Email for Node.js, with a reliability layer

hero:
  name: mailer
  text: Email for Node.js, with a reliability layer
  tagline: SMTP, sendmail, MIME and DKIM of its own, eighteen HTTP providers and JMAP, with failover, retries, rate limits and idempotency around them, and verified webhooks into one model of delivery events. Zero dependencies. Next on top, a persistent queue and an audit log.
  image:
    src: /logo-mark.svg
    alt: mailer
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Transports
      link: /guide/getting-started#choosing-a-transport
    - theme: alt
      text: Compared with alternatives
      link: /guide/comparison

features:
  - icon: ✉️
    title: SMTP of its own
    details: "Pooling, STARTTLS, AUTH PLAIN, LOGIN and OAuth 2.0, PIPELINING, SIZE, DSN and SMTPUTF8, on node:net and node:tls, through an HTTP CONNECT proxy if you need one; and sendmail. Certificates are verified, and credentials never cross plain text."
    link: /transports/smtp
    linkText: SMTP transport
  - icon: 🔏
    title: MIME and DKIM
    details: "createMessage validates addresses, headers and attachments, and takes List-Unsubscribe with one-click. The MIME writes IDN domains as punycode, keeps the Bcc out of the headers, carries inline images and iCalendar invitations, and is DKIM-signed with RSA or Ed25519."
    link: /messages/compose
    linkText: Composing messages
  - icon: 🌐
    title: Eighteen HTTP providers and JMAP
    details: "Amazon SES v2, Resend, SendGrid, Mailgun, Postmark, Brevo, Mailjet, MailerSend, SparkPost and nine more on fetch, and JMAP. One Transport contract and one Receipt with classified errors: swap the provider, keep the messages."
    link: /guide/getting-started#choosing-a-transport
    linkText: Choose a transport
  - icon: 🧩
    title: Decorators around any transport
    details: "A pool with strategies and failover, retries with backoff, jitter and Retry-After, a circuit breaker, token-bucket rate limits, idempotency keys, hooks, mirroring, OpenTelemetry spans and metrics, logs through your pino logger, and a mock for tests."
    link: /transports/pool
    linkText: Pool, retry, breaker
  - icon: 🪶
    title: Zero dependencies
    details: "Built on node:* and fetch. The OpenTelemetry providers, the logger, React Email's render and, later, the queue driver come from your application. Node.js 22+, tested on Bun and Deno, CommonJS with ESM imports, hand-written types."
    link: /api/exports
    linkText: API
  - icon: 🧾
    title: Delivery events, then the reliability layer
    details: "The webhooks of fifteen providers, each verified before it is read, give one model of delivery events. In design: a persistent queue and outbox, an append-only audit log and suppression. None of the fourteen libraries compared has the three."
    link: /guide/webhooks
    linkText: Webhooks and events
---

::: tip Status
The transport layer is here, ported from [upyo](https://github.com/dahlia/upyo) 0.7.0 (MIT), with
what [nodemailer](https://github.com/nodemailer/nodemailer),
[unemail](https://github.com/productdevbook/unemail) and
[sently](https://github.com/omqkhafi/sently) did better ported in 1.1: one package, with a subpath
per transport and decorator. Delivery events are here too; the queue and the audit log are being
designed. See [Why @alexify/mailer?](/guide/why) for the plan.
:::

## A quick look

```js
const { createMessage } = require('@alexify/mailer');
const { SmtpTransport } = require('@alexify/mailer/smtp');
const { createRetryTransport } = require('@alexify/mailer/retry');

const transport = createRetryTransport(
  new SmtpTransport({
    host: 'smtp.example.com',
    port: 587,
    auth: { user: 'user@example.com', pass: 'secret' },
  }),
  { maxAttempts: 3 },
);

const receipt = await transport.send(
  createMessage({
    from: 'Alex <alex@example.com>',
    to: 'bob@example.net',
    subject: 'Your invoice',
    content: { text: 'Attached.', html: '<p>Attached.</p>' },
  }),
);

if (receipt.successful) console.log(receipt.messageId);
else console.error(receipt.errorMessages, receipt.retryable);
```
