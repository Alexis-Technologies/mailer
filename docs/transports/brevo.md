# Brevo transport

The Brevo transport sends through the transactional email API of [Brevo]
(formerly Sendinblue), from the Brevo drivers of unemail and sently.

[Brevo]: https://www.brevo.com/

## Installation

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

## Basic usage

```js
const { createMessage } = require('@alexify/mailer');
const { BrevoTransport } = require('@alexify/mailer/brevo');

const transport = new BrevoTransport({ apiKey: process.env.BREVO_API_KEY });

const receipt = await transport.send(
  createMessage({
    from: 'Shop <shop@example.com>',
    to: 'user@example.com',
    subject: 'Your order has shipped',
    content: { html: '<p>On its way.</p>' },
    tags: ['orders'],
    metadata: { orderId: '42' },
    idempotencyKey: 'order-42-shipped',
  }),
);
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `apiKey` | (required) | A transactional API key (`xkeysib-…`). |
| `sandbox` | `false` | Brevo checks each request in full and drops it (`X-Sib-Sandbox: drop`). |
| `concurrency` | `5` | The most requests of `sendMany()` at once. |
| `baseUrl` | `https://api.brevo.com` | HTTPS, or HTTP to this machine. |
| `timeout` | `30000` | Milliseconds a request may take; 0 or `Infinity` for none. |
| `retries` | `3` | Retries of a request. |
| `headers` | | Header fields added to every request. |
| `fetch`, `logger`, `generateId` | | As for every transport. |

## What a message becomes

- `scheduledAt` schedules the message (`scheduledAt` of Brevo).
- `tags` are Brevo's tags, and `metadata` goes in `X-Mailin-custom`, which Brevo
  returns in its webhook events.
- List-* fields, priority and threading go in `headers`.
- Brevo has no per-message tracking switch, so `tracking` is not sent.
- Brevo takes one reply-to address and no inline attachment, so a second reply-to
  address and an inline attachment are refused with a failed receipt rather than
  dropped.

## Idempotency

Every request carries an idempotency key among the headers of the message, where
Brevo's documentation puts it: the message's `idempotencyKey`, or one generated
with `generateId`, turned into the UUID Brevo takes (the same key, the same UUID).
So a request that timed out, which Brevo may have taken, is retried safely, and
Brevo answers a repeated key with `duplicate_parameter`, which the receipt reports
as `deliveryUnknown` with the code `brevo.duplicate_parameter`: the message went
with the earlier request and is not sent again.

## Errors and batches

A `code` of Brevo becomes the receipt's `brevo.<code>`: `unauthorized` and
`permission_denied` are `auth`, `not_enough_credits` and
`account_under_validation` `configuration`.  `sendMany()` sends `concurrency`
single requests at a time, each with its own key and receipt, rather than the
`messageVersions` of one request, which share the attachments of the request.

## Verifying the configuration

`verify()` reads the account of the key (`GET /v3/account`).
