# SparkPost transport

The SparkPost transport sends through the Transmissions API of [SparkPost], from
the SparkPost transport of sently.

[SparkPost]: https://www.sparkpost.com/

## Installation

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

## Basic usage

```js
const { createMessage } = require('@alexify/mailer');
const { SparkPostTransport } = require('@alexify/mailer/sparkpost');

const transport = new SparkPostTransport({
  apiKey: process.env.SPARKPOST_API_KEY,
  region: 'eu',
});

const receipt = await transport.send(
  createMessage({
    from: 'Shop <shop@example.com>',
    to: 'user@example.com',
    cc: 'orders@example.com',
    subject: 'Your order has shipped',
    content: { html: '<p>On its way.</p>' },
    tags: ['orders'],
  }),
);
if (receipt.successful) console.log(receipt.messageId); // the transmission id
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `apiKey` | (required) | An API key with the Transmissions permission. |
| `region` | `'us'` | `'us'` for `api.sparkpost.com`, `'eu'` for `api.eu.sparkpost.com`. |
| `baseUrl` | the region's | HTTPS, or HTTP to this machine, in place of the region's host. |
| `campaignId` | | The `campaign_id` of every transmission. |
| `transactional` | | Marks every transmission as transactional, or not. |
| `openTracking`, `clickTracking` | the account's | Tracking, unless a message sets its own `tracking`. |
| `concurrency` | `5` | The most requests of `sendMany()` at once. |
| `timeout` | `30000` | Milliseconds a request may take; 0 or `Infinity` for none. |
| `retries` | `3` | Retries of a request that failed before SparkPost took it. |
| `headers` | | Header fields added to every request. |
| `fetch`, `logger`, `generateId` | | As for every transport. |

## What a message becomes

- SparkPost sends a copy to each recipient. Every copy carries the To field of the
  message (`header_to`), and the Cc field goes in its headers, so Cc and Bcc
  recipients see what the sender wrote; a Bcc address is in no field.
- `scheduledAt` is `start_time`; `tags` (up to 10) the tags of each recipient,
  which reach the events; `metadata` the metadata of the transmission;
  `tracking` its `open_tracking` and `click_tracking`.
- Custom header fields, List-* and the threading fields go in the headers of the
  content.
- An inline attachment goes in `inline_images`, named by its Content-ID, the
  others in `attachments`.

SparkPost answers with the counts of the recipients it accepted and turned away
(such as those on its suppression list). A receipt counts the latter in
`rejectedRecipientCount`; when none was accepted it fails as `rejected`, not
retryable. A suppressed single recipient is the error 1902, also `rejected`; an
unverified sending domain (7001) is a `configuration` failure, and the 420 of a
spent sending limit a `rate-limit` one.

## Raw messages

`sendRaw()` sends a ready MIME message as `email_rfc822`, to the recipients of its
envelope. The API takes it as a JSON string, so its bytes must be UTF-8; others
are refused as `validation`, before any request.

```js
const receipt = await transport.sendRaw({
  envelope: { from: 'shop@example.com', to: ['user@example.com'] },
  content: mimeBytes,
});
```

## Batches

`sendMany()` sends `concurrency` transmissions at a time, each with its own
receipt.

## Verifying the configuration

`verify()` reads the account (`GET /api/v1/account`); a key without that
permission is verified too.
