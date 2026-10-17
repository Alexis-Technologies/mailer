# Mailjet transport

The Mailjet transport sends through the Send API v3.1 of [Mailjet], from the
Mailjet driver of unemail.

[Mailjet]: https://www.mailjet.com/

## Installation

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

## Basic usage

```js
const { createMessage } = require('@alexify/mailer');
const { MailjetTransport } = require('@alexify/mailer/mailjet');

const transport = new MailjetTransport({
  apiKey: process.env.MJ_APIKEY_PUBLIC,
  apiSecret: process.env.MJ_APIKEY_PRIVATE,
});

const receipt = await transport.send(
  createMessage({
    from: 'Shop <shop@example.com>',
    to: 'user@example.com',
    subject: 'Autumn sale',
    content: { html: '<p>…</p>', text: '…' },
    tags: ['autumn-sale'],
    metadata: { segment: 'returning' },
  }),
);
if (receipt.successful) console.log(receipt.messageId); // the MessageUUID
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `apiKey`, `apiSecret` | (required) | The key pair, sent with Basic authentication. |
| `sandbox` | `false` | `SandboxMode`: each message is checked and dropped; the receipt id is `sandbox-…`. |
| `openTracking`, `clickTracking` | the account's | Tracking of an HTML message, unless it sets its own `tracking`. |
| `baseUrl` | `https://api.mailjet.com` | HTTPS, or HTTP to this machine. |
| `timeout` | `30000` | Milliseconds a request may take; 0 or `Infinity` for none. |
| `retries` | `3` | Retries of a request that failed before Mailjet took it. |
| `headers` | | Header fields added to every request. |
| `fetch`, `logger`, `generateId` | | As for every transport. |

## What a message becomes

- The first tag is the `CustomCampaign`; Mailjet has one, so a second is refused.
- `metadata` is the `EventPayload`, which Mailjet returns in its events.
- `tracking` is `TrackOpens` and `TrackClicks`, sent only with an HTML part, as
  Mailjet refuses them without one.
- An inline attachment goes in `InlinedAttachments` with its Content-ID.
- Mailjet sets some fields itself and fails a message that gives one (`send-0011`):
  `List-Id`, `X-Mailer`, `Date` and others are refused before the request, so a
  message with `list.id` cannot go through Mailjet.
- Mailjet takes one reply-to address, a subject of at most 255 characters and 50
  recipients a message; it cannot schedule a message.  Each is refused with an
  `unsupported` receipt, which `./pool` fails over with.

## Batches and errors

`Messages` is Mailjet's batch: `sendMany()` sends requests of at most 50
recipients, as Mailjet counts them over the whole request, and 15 MB, reading
its input a batch at a time.  When one message of a request fails, Mailjet answers 400 with
the answers of all of them, so each message gets the receipt of its own answer:
those that went succeed, the others fail with the code Mailjet gives
(`mailjet.send-0003`) and the fields it names.

## Verifying the configuration

`verify()` reads the profile of the key pair (`GET /v3/REST/myprofile`).
