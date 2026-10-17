# ZeptoMail transport

The ZeptoMail transport sends through the email API of [ZeptoMail], the
transactional service of Zoho, from the ZeptoMail driver of unemail.

[ZeptoMail]: https://www.zoho.com/zeptomail/

## Installation

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

## Basic usage

```js
const { createMessage } = require('@alexify/mailer');
const { ZeptoMailTransport } = require('@alexify/mailer/zeptomail');

const transport = new ZeptoMailTransport({
  token: process.env.ZEPTOMAIL_TOKEN,
  bounceAddress: 'bounce@bounces.example.com',
});

const receipt = await transport.send(
  createMessage({
    from: 'Shop <shop@example.com>',
    to: 'user@example.com',
    subject: 'Your order has shipped',
    content: { html: '<p>On its way.</p>' },
    tags: ['order-42'],
  }),
);
if (receipt.successful) console.log(receipt.messageId); // the request_id
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `token` | (required) | The Send Mail token of a Mail Agent; `Zoho-enczapikey ` is added unless it is there. |
| `baseUrl` | `https://api.zeptomail.com` | HTTPS, or HTTP to this machine; the host of the account's data center, such as `https://api.zeptomail.eu`. |
| `bounceAddress` | | The bounce address, on a bounce domain verified with ZeptoMail. |
| `clientReference` | | The `client_reference` of a message without a tag. |
| `openTracking`, `clickTracking` | the agent's | Tracking, unless a message sets its own `tracking`. |
| `concurrency` | `5` | The most requests of `sendMany()` at once. |
| `timeout` | `30000` | Milliseconds a request may take; 0 or `Infinity` for none. |
| `retries` | `3` | Retries of a request that failed before ZeptoMail took it. |
| `headers` | | Header fields added to every request. |
| `fetch`, `logger`, `generateId` | | As for every transport. |

## What a message becomes

- ZeptoMail has no tags: a message's one tag is its `client_reference`, which its
  reports and events show; a second tag is refused.
- `metadata` goes in `X-Metadata-<key>` headers (`mime_headers`), with custom
  header fields, List-* and the threading fields; `tracking` is `track_opens`
  and `track_clicks`.
- An inline attachment goes in `inline_images` with its Content-ID as `cid`.
- ZeptoMail takes 500 addresses in each of `to`, `cc` and `bcc`, 60
  attachments and a subject of 500 characters; more are refused before the
  request. It cannot schedule a message, so `scheduledAt` is refused as
  `unsupported`.

ZeptoMail answers 201 with a `request_id`, the receipt's id; an answer without
one is reported as `deliveryUnknown`. The code in the details of an error says
more than its status: an invalid token (`SERR_157`) is `auth`, a rate limit
(`SM_133`) `rate-limit`, spent credits (`LE_101`, `LE_102`) `configuration`,
and a malformed request (`TM_3201`, `TM_3301`, `TM_8001`) `validation`.

## Batches

`sendMany()` sends `concurrency` single requests at a time, each with its own
receipt. The batch endpoint is not used: it sends one message to many
recipients, with one answer for all of them.

## Verifying the configuration

This transport has no `verify()`: a Send Mail token can only send, and
ZeptoMail offers no request that checks it.
