# Azure Communication Services transport

The Azure transport sends through the Email API of [Azure Communication
Services], signed with the access key of the resource (HMAC-SHA256) on
`node:crypto`, with no Azure SDK. It comes from the Azure Communication
Services driver of unemail.

[Azure Communication Services]: https://learn.microsoft.com/en-us/azure/communication-services/concepts/email/email-overview

## Installation

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

## Basic usage

```js
const { createMessage } = require('@alexify/mailer');
const { AzureTransport } = require('@alexify/mailer/azure');

const transport = new AzureTransport({
  connectionString: process.env.ACS_CONNECTION_STRING,
});

const receipt = await transport.send(
  createMessage({
    from: 'DoNotReply@example.com',
    to: 'user@example.com',
    subject: 'Your order has shipped',
    content: { html: '<p>On its way.</p>' },
    idempotencyKey: 'order-42-shipped',
  }),
);
if (receipt.successful) console.log(receipt.messageId); // the operation id
```

The connection string is the one the Keys of the resource show,
`endpoint=https://….communication.azure.com/;accesskey=…`. It is never read from
the environment: pass it, or `endpoint` and `accessKey`, as options.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `connectionString` | | The connection string of the resource. |
| `endpoint`, `accessKey` | | Its endpoint (HTTPS, or HTTP to this machine) and base64 access key, in place of the connection string. |
| `apiVersion` | `'2025-09-01'` | The version of the Email API. |
| `userEngagementTrackingDisabled` | | Turns tracking off for every message, unless a message sets its own `tracking`. |
| `concurrency` | `5` | The most requests of `sendMany()` at once. |
| `timeout` | `30000` | Milliseconds a request may take; 0 or `Infinity` for none. |
| `retries` | `3` | Retries of a request; see below. |
| `headers` | | Header fields added to every request. |
| `now` | `Date.now` | The clock of the signatures and of the repeats. |
| `fetch`, `logger`, `generateId` | | As for every transport. |

## What a message becomes

- The sender goes as its address alone: the API has no field for a display
  name, which is that of the sender username in the resource.
- `metadata` goes in `X-Metadata-<key>` headers, with custom header fields,
  List-* and the threading fields.
- Azure has one switch for open and click tracking, which can turn off what the
  resource has on but not the reverse. `tracking` sets it; a message that asks
  for opens without clicks, or the reverse, is refused.
- Azure has no tags, which are not sent, as over SMTP; it cannot schedule a
  message, so `scheduledAt` is refused as `validation`.
- An inline attachment goes with its Content-ID as `contentId`.
- A request may be at most 10 MB, its attachments in base64 included; a larger
  one is refused before it is sent.

## Retries and repeats

A send is a long-running operation, which Azure accepts with a 202 and the id of
the operation, the receipt's id. Every send carries a key: the message's
`idempotencyKey` as a UUID, or one made for that send. It is the
`Operation-Id` and the `Repeatability-Request-Id` of the request, with the time
of the first attempt as `Repeatability-First-Sent`. Azure answers a repeat it
has tracked, within five minutes, with the outcome of the first request rather
than sending again, so a retry after a timeout or a reset is safe; a repeat
answered 409 (the first still running) or 412 (after the five minutes) is
reported as `deliveryUnknown`, never sent again.

The same `idempotencyKey` sent again within five minutes is a repeat too, and
gets the outcome of the first. Past that window Azure no longer knows it.

## Batches

`sendMany()` sends `concurrency` single requests at a time, each with its own
receipt.

## Verifying the configuration

`verify()` reads an operation that does not exist, signed with the key: Azure
answers 404 when it accepts the signature and 401 when it does not.
