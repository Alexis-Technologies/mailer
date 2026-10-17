# Scaleway transport

The Scaleway transport sends through the [Transactional Email] API of Scaleway,
from the Scaleway driver of unemail. The API is `v1alpha1`, which Scaleway may
change without the guarantees of a stable version.

[Transactional Email]: https://www.scaleway.com/en/transactional-email-tem/

## Installation

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

## Basic usage

```js
const { createMessage } = require('@alexify/mailer');
const { ScalewayTransport } = require('@alexify/mailer/scaleway');

const transport = new ScalewayTransport({
  secretKey: process.env.SCW_SECRET_KEY,
  projectId: process.env.SCW_DEFAULT_PROJECT_ID,
});

const receipt = await transport.send(
  createMessage({
    from: 'Shop <shop@example.com>',
    to: 'user@example.com',
    subject: 'Your order has shipped',
    content: { html: '<p>On its way.</p>' },
  }),
);
if (receipt.successful) console.log(receipt.messageId); // the id of the email
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `secretKey` | (required) | The secret key of an API key, sent as `X-Auth-Token`. |
| `projectId` | (required) | The project the emails are made in. |
| `region` | `'fr-par'` | The region of Transactional Email. |
| `baseUrl` | `https://api.scaleway.com` | HTTPS, or HTTP to this machine. |
| `concurrency` | `5` | The most requests of `sendMany()` at once. |
| `timeout` | `30000` | Milliseconds a request may take; 0 or `Infinity` for none. |
| `retries` | `3` | Retries of a request that failed before Scaleway took it. |
| `headers` | | Header fields added to every request. |
| `fetch`, `logger`, `generateId` | | As for every transport. |

## What a message becomes

- Scaleway has no field for the reply-to addresses or for metadata: Reply-To
  and `metadata` (`X-Metadata-<key>`) go in `additional_headers`, with custom
  header fields, List-* and the threading fields.
- Scaleway has no tags or per-message tracking, which are not sent, as over
  SMTP. It cannot schedule a message, so `scheduledAt` is refused as
  `validation`.
- It has no Content-ID for an attachment, so an inline one is refused rather
  than sent as a file the HTML cannot refer to.
- A request may be at most 2 MB, its attachments in base64 included; a larger
  one is refused before it is sent. Scaleway takes only the attachment types
  it lists, and answers another with a 400 naming it.

Scaleway makes an email of a message for each recipient; the receipt has the id
of the first. An error's type says more than its status: `invalid_arguments`
names the fields, and `quotas_exceeded`, the monthly quota, is a
`configuration` failure that no retry clears.

## Batches

`sendMany()` sends `concurrency` single requests at a time, each with its own
receipt.

## Verifying the configuration

`verify()` lists the domains of the project; a key without that permission is
verified too.
