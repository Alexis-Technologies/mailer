# SMTP2GO transport

The SMTP2GO transport sends through the email API of [SMTP2GO], from the
SMTP2GO driver of unemail.

[SMTP2GO]: https://www.smtp2go.com/

## Installation

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

## Basic usage

```js
const { createMessage } = require('@alexify/mailer');
const { Smtp2goTransport } = require('@alexify/mailer/smtp2go');

const transport = new Smtp2goTransport({
  apiKey: process.env.SMTP2GO_API_KEY,
  region: 'eu',
});

const receipt = await transport.send(
  createMessage({
    from: 'Shop <shop@example.com>',
    to: 'user@example.com',
    subject: 'Your order has shipped',
    content: { html: '<p>On its way.</p>', text: 'On its way.' },
  }),
);
if (receipt.successful) console.log(receipt.messageId); // the email_id
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `apiKey` | (required) | An API key with the permission to send. |
| `region` | | `'us'`, `'eu'` or `'au'`; without one, `api.smtp2go.com` routes to the region nearest the resolver. |
| `baseUrl` | the region's | HTTPS, or HTTP to this machine, in place of the region's host. |
| `fastAccept` | | SMTP2GO accepts the message at once and sends it in the background. |
| `concurrency` | `5` | The most requests of `sendMany()` at once. |
| `timeout` | `30000` | Milliseconds a request may take; 0 or `Infinity` for none. |
| `retries` | `3` | Retries of a request that failed before SMTP2GO took it. |
| `headers` | | Header fields added to every request. |
| `now` | `Date.now` | The clock for the 3-day window of `scheduledAt`. |
| `fetch`, `logger`, `generateId` | | As for every transport. |

## What a message becomes

- `scheduledAt` is `schedule`, at most 3 days ahead.
- SMTP2GO has no field for the reply-to addresses or for metadata: Reply-To
  goes in the header fields, as SMTP2GO documents, and `metadata` in
  `X-Metadata-<key>` fields, with custom fields, List-* and the threading
  fields.
- SMTP2GO has no tags, and tracking is set on the API key, so `tags` and
  `tracking` are not sent, as over SMTP.
- An inline attachment goes in `inlines`, named by its Content-ID, which the
  HTML refers to as `cid:`.
- SMTP2GO takes 100 addresses in each of `to`, `cc` and `bcc`; more are refused
  before the request.

SMTP2GO answers 200 even when the send failed: the outcome is in the `failed`
count and the `failures` of its answer, which the receipt reads. A failed send
is `rejected`, not retryable, with SMTP2GO's messages. With `fastAccept` the
answer says nothing of a failure, which only the events tell. An error of the
request comes with a 400 whose code names it; one about the key (such as
`API_KEY_NOT_FOUND` or `ENDPOINT_PERMISSION_DENIED`) is `auth`.

The receipt's id is the `email_id` of the answer, which the events name, or the
`schedule_id` of a scheduled message without one.

## Batches

`sendMany()` sends `concurrency` single requests at a time, each with its own
receipt.

## Verifying the configuration

`verify()` reads the summary of the account (`POST /v3/stats/email_summary`); a
key without that permission, which SMTP2GO answers with
`ENDPOINT_PERMISSION_DENIED`, is verified too.
