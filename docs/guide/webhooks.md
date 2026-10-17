# Webhooks and events

A provider tells what became of a message after it took it — delivered,
bounced, complained of — through a webhook: an HTTP request to the
application. `@alexify/mailer/webhooks` verifies those requests and reads them
into one model of events, the same for every provider.

## Verify, then read

Nothing is read before it is verified. A verifier takes the **raw body** of the
request, a string or bytes, as the signature covers its exact bytes: with
Express, `express.raw({ type: '*/*' })`; with Fastify, a content-type parser that
keeps the body as a buffer.

```js
const express = require('express');
const { createSesWebhookVerifier, WebhookVerificationError } = require('@alexify/mailer/webhooks');

const ses = createSesWebhookVerifier({
  topicArns: ['arn:aws:sns:eu-west-1:123456789012:ses-events'],
});

app.post('/webhooks/ses', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const { events, confirmation } = await ses.verify({ body: req.body, headers: req.headers });
    if (confirmation) await subscriptions.review(confirmation);
    for (const event of events) await deliveries.record(event);
    res.sendStatus(200);
  } catch (error) {
    if (!(error instanceof WebhookVerificationError)) throw error;
    // A replay was delivered before: tell the provider it arrived.
    res.sendStatus(error.reason === 'replay' ? 200 : 401);
  }
});
```

A refused request throws a `WebhookVerificationError` whose `reason` says why:
`signature`, `timestamp`, `replay`, `payload`, `certificate`, `topic` or
`credentials`.

## Events

Each event is one message and one recipient: an event of several recipients is
as many events.

| Field | |
| --- | --- |
| `provider` | The provider, such as `ses`. |
| `type` | `accepted`, `delivered`, `deferred`, `bounced`, `rejected`, `complained`, `unsubscribed`, `opened`, `clicked` or `unknown`. |
| `id` | The id of the event, the same each time the provider sends it again. |
| `messageId` | The provider's id of the message, the `messageId` of its receipt. |
| `recipient` | The recipient, when the event names one. |
| `occurredAt` | When it happened. |
| `bounce` | For a bounce: `kind` (`hard`, `soft` or `undetermined`), `code` and `diagnostic`. |
| `reason` | Why, for a rejection, a deferral or a bounce. |
| `url` | The link of a click. |
| `tags`, `metadata` | The tags and metadata of the message, as the transport sent them. |
| `raw` | The provider's record. |

`rejected` is a message the provider never attempted, such as one to a
suppressed address; `deferred` one it keeps trying; `unknown` an event the model
has no name for, kept with its `raw` record.

## Time and replays

A signed request is taken only within `toleranceMs` of now, and only once: its
id goes into a replay store, in this process by default. A request taken before
is refused as `replay`; answer it with a 2xx, as the provider delivered it
before. Several processes share a store of their own, such as one on Redis,
with `add(id, ttlMs)` that answers whether the id is new; `replayStore: null`
turns the check off, for an application that deduplicates by the `id` of the
events itself.

| Option | Default | |
| --- | --- | --- |
| `toleranceMs` | 5 minutes (an hour for SES) | How far from now a request may be signed. |
| `replayStore` | in this process | The ids already taken, or `null`. |
| `maxBodyBytes` | 5 MiB | The longest body taken. |
| `now` | `Date.now` | The clock. |

## Amazon SES

SES publishes its events to an SNS topic, which posts them to the webhook.
`createSesWebhookVerifier` takes a message only from a topic in `topicArns`,
signed (SignatureVersion 1 or 2) with the certificate of an
`https://sns.<region>.amazonaws.com/….pem` URL, which it reads once through
`fetch` and keeps; within an hour, as SNS retries a delivery with the time it
first published it; and once, by its `MessageId`.

A subscription message is verified and handed back as `confirmation`, with
`subscribeUrl` to fetch when the application wants the subscription; nothing is
confirmed for it. A bounce is `hard` when SES says Permanent, `soft` when
Transient; a reject or a rendering failure is `rejected`. The `category` tags
of the message are its `tags`, as `./ses` sends them, and its other tags its
`metadata`.

## Resend

```js
const resend = createResendWebhookVerifier({ secret: process.env.RESEND_WEBHOOK_SECRET });
```

Resend signs its webhooks with Svix: the HMAC-SHA256 of `svix-id`,
`svix-timestamp` and the body, with the secret `whsec_…` of the webhook. A
secret that is not one is refused when the verifier is made. An event names
its recipients in `to`, one event each; a bounce is `hard` when Resend says
Permanent, `soft` when Transient; a failed or suppressed email is `rejected`.
`tag1`, `tag2`… of the email's tags are the tags of the message and the others
its metadata, as `./resend` sends them.

## SendGrid

```js
const sendgrid = createSendGridWebhookVerifier({
  publicKey: process.env.SENDGRID_WEBHOOK_PUBLIC_KEY,
});
```

Turn on the Signed Event Webhook in SendGrid and pass its verification key
(base64, as SendGrid shows it, or PEM). The signature is ECDSA P-256 over the
timestamp and the body. SendGrid posts events in batches: each event is taken
once by its `sg_event_id`, so a batch sent again keeps only what is new, and is
refused as `replay` when nothing is. A `bounce` is hard, a `blocked` one soft; a
`dropped` message is `rejected`; an unsubscribe is `unsubscribed`. The
categories are the tags of the message and its custom arguments its metadata;
`messageId` is the `X-Message-Id` of the receipt, without the filter SendGrid
adds after it.

## Mailgun

```js
const mailgun = createMailgunWebhookVerifier({
  signingKey: process.env.MAILGUN_WEBHOOK_SIGNING_KEY,
});
```

The signature is the HMAC-SHA256 of the timestamp and the token of the body,
with the HTTP webhook signing key; the token is taken once. A permanent
failure is a hard bounce, a temporary one a deferred soft bounce, and a
failure for a suppressed address `rejected`. The user variables are the
metadata, and `messageId` the id of the receipt, in angle brackets.

## Postmark

```js
// The webhook URL in Postmark: https://hook:s3cret@example.com/webhooks/postmark
const postmark = createPostmarkWebhookVerifier({ username: 'hook', password: 's3cret' });
```

Postmark signs nothing, so the URL of the webhook carries credentials, which
the verifier requires and compares in constant time. With no time or id
signed, nothing holds a request to a window or takes it once: deduplicate by
the `id` of the events. A bounce is read by its type: `HardBounce` is hard,
`SoftBounce` soft, `Transient` deferred, `SpamComplaint` a complaint,
`ManuallyDeactivated` a rejection.

## MailerSend and Mailtrap

```js
const mailersend = createMailerSendWebhookVerifier({ secret: process.env.MAILERSEND_WEBHOOK_SECRET });
const mailtrap = createMailtrapWebhookVerifier({ secret: process.env.MAILTRAP_WEBHOOK_SECRET });
```

Both sign the raw body with HMAC-SHA256, in hexadecimal in `Signature`
(MailerSend) or `Mailtrap-Signature`. Neither signs a time, so no window holds
a request; each event is taken once by its id instead, kept a day and an hour,
past Mailtrap's retries of a day. Mailtrap posts JSON or JSON Lines, both read.
MailerSend's metadata comes back from the `X-Metadata-<key>` fields of the email
when the event carries them; Mailtrap's category and `tag_` variables are the
tags and its other custom variables the metadata, as `./mailtrap` sends them.

## Brevo

```js
const brevo = createBrevoWebhookVerifier({ token: process.env.BREVO_WEBHOOK_TOKEN });
```

Brevo signs nothing: give the webhook a token, its `auth` token, which comes as
`Authorization: Bearer <token>`, or a custom header with `header: 'x-webhook-token'`.
The verifier requires it and compares it in constant time. A blocked or invalid
address is `rejected`, a soft bounce soft, and the metadata comes back from
`X-Mailin-custom`, as `./brevo` sends it.

## Mailjet and SparkPost

```js
// The callback URL in Mailjet: https://hook:s3cret@example.com/webhooks/mailjet
const mailjet = createMailjetWebhookVerifier({ username: 'hook', password: 's3cret' });
const sparkpost = createSparkPostWebhookVerifier({ username: 'hook', password: 's3cret' });
```

Neither signs its events, so their webhooks carry Basic credentials (in
Mailjet's callback URL, SparkPost's `auth_type: basic`), which the verifiers
require. Mailjet's message id is the MessageUUID of the receipt, its custom
campaign the tag and its event payload the metadata; SparkPost's message id is
the transmission's, and a bounce is hard for the classes 10, 30 and 90,
undetermined for 1, soft for the others. As for Postmark, nothing holds a
request to a window or takes it once.
