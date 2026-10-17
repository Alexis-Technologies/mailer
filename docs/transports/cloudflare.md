# Cloudflare transport

The Cloudflare transport sends through the REST API of [Cloudflare Email
Service], with an API token, from any runtime with `fetch`. It comes from the
REST driver of unemail. Inside a Worker, the service's binding needs no token
and is one hop shorter; this transport is for everywhere else.

[Cloudflare Email Service]: https://developers.cloudflare.com/email-service/

## Installation

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

## Basic usage

```js
const { createMessage } = require('@alexify/mailer');
const { CloudflareTransport } = require('@alexify/mailer/cloudflare');

const transport = new CloudflareTransport({
  accountId: process.env.CF_ACCOUNT_ID,
  apiToken: process.env.CF_API_TOKEN,
});

const receipt = await transport.send(
  createMessage({
    from: 'Shop <shop@example.com>',
    to: 'user@example.com',
    subject: 'Your order has shipped',
    content: { html: '<p>On its way.</p>' },
  }),
);
if (receipt.successful) console.log(receipt.messageId); // the message_id
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `accountId` | (required) | The id of the Cloudflare account. |
| `apiToken` | (required) | An API token with the permission to send email. |
| `baseUrl` | `https://api.cloudflare.com/client/v4` | HTTPS, or HTTP to this machine. |
| `concurrency` | `5` | The most requests of `sendMany()` at once. |
| `timeout` | `30000` | Milliseconds a request may take; 0 or `Infinity` for none. |
| `retries` | `3` | Retries of a request that failed before Cloudflare took it. |
| `headers` | | Header fields added to every request. |
| `fetch`, `logger`, `generateId` | | As for every transport. |

## What a message becomes

- Addresses go as `{ address, name }`, the reply-to address as `reply_to` (one
  only) and an inline attachment with its Content-ID as `content_id`, the
  shapes of the REST API.
- `metadata` goes in `X-Metadata-<key>` headers, with custom header fields,
  List-* and the threading fields. Cloudflare takes only the header fields it
  lists, and answers another with a 400.
- Cloudflare has no tags or per-message tracking, which are not sent, as over
  SMTP; it cannot schedule a message, so `scheduledAt` is refused as
  `validation`.
- A message has at most 50 recipients across `to`, `cc` and `bcc`; more are
  refused before the request.

Cloudflare answers with the outcome of each recipient: delivered, queued,
bounced permanently, or dropped as on the suppression list. A receipt is
successful when any was delivered or queued, its id the `message_id` of the
answer; it lists the others in `bouncedRecipients` and `suppressedRecipients`.
When none was accepted it fails as `rejected`, not retryable. A 200 with
`success: false` is a request Cloudflare read but did not act on, a
`validation` failure; an error keeps Cloudflare's numeric code
(`cloudflare.10101`), its category chosen by the status.

## Raw messages

`sendRaw()` sends a ready MIME message through `send_raw`, routed by its
envelope. The API takes it as a JSON string, so its bytes must be UTF-8; others,
and an envelope without a sender, are refused as `validation` before any
request.

## Batches

`sendMany()` sends `concurrency` single requests at a time, each with its own
receipt.

## Verifying the configuration

`verify()` asks Cloudflare whether the token is active, as a token of the account
(`/accounts/{id}/tokens/verify`) and, when it is not one, of a user
(`/user/tokens/verify`).
