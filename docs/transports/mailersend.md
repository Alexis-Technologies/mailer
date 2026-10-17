# MailerSend transport

The MailerSend transport sends through the email API of [MailerSend], from the
MailerSend drivers of unemail and sently.

[MailerSend]: https://www.mailersend.com/

## Installation

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

## Basic usage

```js
const { createMessage } = require('@alexify/mailer');
const { MailerSendTransport } = require('@alexify/mailer/mailersend');

const transport = new MailerSendTransport({ apiKey: process.env.MAILERSEND_API_KEY });

const receipt = await transport.send(
  createMessage({
    from: 'Shop <shop@example.com>',
    to: 'user@example.com',
    subject: 'Your order has shipped',
    content: { html: '<p>On its way.</p>' },
    scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
  }),
);
if (receipt.successful) console.log(receipt.messageId); // the X-Message-Id
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `apiKey` | (required) | An API token. |
| `openTracking`, `clickTracking` | the domain's | Tracking, unless a message sets its own `tracking`. |
| `precedenceBulk` | | Marks every message as bulk. |
| `concurrency` | `5` | The most requests of `sendMany()` at once. |
| `baseUrl` | `https://api.mailersend.com` | HTTPS, or HTTP to this machine. |
| `timeout` | `30000` | Milliseconds a request may take; 0 or `Infinity` for none. |
| `retries` | `3` | Retries of a request that failed before MailerSend took it. |
| `headers` | | Header fields added to every request. |
| `now` | `Date.now` | The clock for the 72-hour window of `scheduledAt`. |
| `fetch`, `logger`, `generateId` | | As for every transport. |

## What a message becomes

- `scheduledAt` is `send_at`, at most 72 hours ahead; `tags` (up to 5) its tags;
  `tracking` its settings.
- `metadata` goes in `X-Metadata-<key>` headers, as MailerSend has no metadata of
  its own and returns custom headers in its events.
- In-Reply-To and References go in `in_reply_to` and `references`, and
  List-Unsubscribe in `list_unsubscribe`; MailerSend writes the
  List-Unsubscribe-Post of one-click itself.
- An inline attachment goes with its Content-ID as `id`.
- MailerSend takes 50 `to`, 10 `cc` and 10 `bcc` recipients and one reply-to
  address; more are refused before the request.

MailerSend answers 202 with an empty body; the receipt's id is the `X-Message-Id`
header of the answer, and an answer without one is reported as `deliveryUnknown`.
A 422 names the fields it refuses and why, which the receipt's message carries.

## Batches

`sendMany()` sends `concurrency` single requests at a time, each with its own
receipt.  The bulk endpoint is not used: it answers with one id for the whole batch
and takes messages that may fail later, which no receipt would tell.

## Verifying the configuration

`verify()` reads the domains of the account (`GET /v1/domains`); a token without
that scope is verified too.
