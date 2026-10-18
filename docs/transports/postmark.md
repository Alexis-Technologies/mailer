# Postmark transport

The Postmark transport sends through the API of [Postmark], from the Postmark
drivers of unemail and sently.

[Postmark]: https://postmarkapp.com/

## Installation

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

## Basic usage

```js
const { createMessage } = require('@alexify/mailer');
const { PostmarkTransport } = require('@alexify/mailer/postmark');

const transport = new PostmarkTransport({ serverToken: process.env.POSTMARK_SERVER_TOKEN });

const receipt = await transport.send(
  createMessage({
    from: 'Shop <shop@example.com>',
    to: 'user@example.com',
    subject: 'Your order has shipped',
    content: { html: '<p>On its way.</p>', text: 'On its way.' },
    tags: ['orders'],
    metadata: { orderId: '42' },
  }),
);
if (receipt.successful) console.log(receipt.messageId); // Postmark's MessageID
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `serverToken` | (required) | The Server API token, not the account token. |
| `messageStream` | Postmark's default | The message stream, such as `broadcast` for bulk mail. |
| `openTracking`, `clickTracking` | the server's | Tracking, unless a message sets its own `tracking`. |
| `baseUrl` | `https://api.postmarkapp.com` | HTTPS, or HTTP to this machine. |
| `timeout` | `30000` | Milliseconds a request may take; 0 or `Infinity` for none. |
| `retries` | `3` | Retries of a request that failed before Postmark took it. |
| `headers` | | Header fields added to every request. |
| `fetch`, `logger`, `generateId` | | As for every transport. |

## What a message becomes

- The sender and recipients go as mailboxes, display names quoted when they need
  it and domains as A-labels.
- The first tag is Postmark's `Tag`; Postmark has one, so a second is refused.
- `metadata` is `Metadata`, `tracking` is `TrackOpens` and `TrackLinks`
  (`HtmlAndText` or `None`).
- List-* fields, priority and threading go in `Headers`.
- An inline attachment goes with `cid:` before its Content-ID, as Postmark wants
  it.
- Postmark cannot schedule a message, so `scheduledAt` is refused with an
  `unsupported` receipt, as is a second tag, and it has no idempotency key.

## Errors

Postmark answers with an `ErrorCode`, which the receipt carries as
`postmark.<code>`, with a category: 10 is `auth`, 406 (an inactive recipient)
`rejected`, 400, 401 and 405 (sender signatures, sending not allowed)
`configuration`, and any other `validation`; none is retried.  A server error or a
connection that was never made is retried; a failure after Postmark may have taken
the message is `deliveryUnknown`.

## Batches

`sendMany()` sends up to 500 messages and 50 MB a request through `/email/batch`,
converting each message as it reads it and sending a request as soon as the
next message would not fit, so that it holds no more than a request at once:
messages with files go in as many requests as their size takes, each of which
fails, or is of unknown delivery, on its own.  Each message has the receipt of
its own answer, so an inactive recipient fails its message alone; a message that
cannot be converted fails alone too.

A batch request has no idempotency key: a timeout or a reset after it was sent
leaves all its messages of unknown delivery at once. Messages with large files,
or any whose delivery must be known one by one, are better sent with `send()`
each (or through `./retry`'s `sendMany`, which sends them one by one at a
bounded concurrency).

## Verifying the configuration

`verify()` reads the server of the token (`GET /server`), and throws when Postmark
refuses the token.
