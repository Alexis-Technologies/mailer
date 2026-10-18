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
const {
  createMemoryReplayStore,
  createSesWebhookVerifier,
  WebhookVerificationError,
} = require('@alexify/mailer/webhooks');

// One process; several share a store of their own (see Time and replays).
const replayStore = createMemoryReplayStore();
const ses = createSesWebhookVerifier({
  topicArns: ['arn:aws:sns:eu-west-1:123456789012:ses-events'],
  replayStore,
});

app.post('/webhooks/ses', express.raw({ type: '*/*' }), async (req, res) => {
  let delivery;
  try {
    delivery = await ses.verify({ body: req.body, headers: req.headers });
  } catch (error) {
    if (!(error instanceof WebhookVerificationError)) throw error;
    return res.sendStatus(error.status);
  }
  try {
    if (delivery.confirmation) await subscriptions.review(delivery.confirmation);
    for (const event of delivery.events) await deliveries.record(event);
    await delivery.commit();
    res.sendStatus(200);
  } catch (error) {
    // The provider delivers the request again, and it is taken again.
    await delivery.release();
    throw error;
  }
});
```

A refused request throws a `WebhookVerificationError` whose `reason` says why,
and whose `status` is what to answer the provider with:

| `reason` | `status` | |
| --- | --- | --- |
| `replay` | 200 | Taken before: the provider may stop. |
| `pending` | 503 | Being handled by another delivery of it: the provider tries again. |
| `payload` | 400 | Verified, or too long, but not a body of the provider. |
| `certificate` | 401, or 503 | A signing certificate refused, or one that could not be read. |
| `signature`, `timestamp`, `topic`, `credentials` | 401 | Not the provider's, or too old. |

## Events

Each event is one message and one recipient: an event of several recipients is
as many events.

| Field | |
| --- | --- |
| `provider` | The provider, such as `ses`. |
| `type` | `accepted`, `delivered`, `deferred`, `bounced`, `rejected`, `complained`, `unsubscribed`, `opened`, `clicked` or `unknown`. |
| `id` | The id of the event, the same each time the provider sends it again. |
| `messageId` | The provider's id of the message, the `messageId` of its receipt. |
| `rfcMessageId` | The Message-ID the message was sent with, when the event carries it (SES, SendGrid, Mailgun, and the providers whose events carry the header fields of the email). |
| `recipient` | The recipient, when the event names one, its domain in lower case. |
| `occurredAt` | When it happened. |
| `bounce` | For a bounce: `kind` (`hard`, `soft` or `undetermined`), `code` and `diagnostic`. |
| `reason` | Why, for a rejection, a deferral or a bounce. |
| `url` | The link of a click. |
| `tags`, `metadata` | The tags and metadata of the message, as the transport sent them. |
| `raw` | The provider's record. |

`rejected` is a message the provider never attempted, such as one to a
suppressed address; `deferred` one it keeps trying; `unknown` an event the model
has no name for, kept with its `raw` record.

A receipt of unknown delivery (`deliveryUnknown`) has no `messageId` of the
provider to find its events by. Give the message a `messageId` of its own, or
send it through `./pool` or `./retry`, which pin one, and find its events by
`rfcMessageId`, where the provider tells it.

## Time and replays

A signed request is taken only within `toleranceMs` of now, and only once, by
the id the provider gives it, in two steps:

1. `verify()` **reserves** the id in the replay store for `leaseMs`, and gives
   the events with `commit()` and `release()`.
2. The application **commits** the events once it has handled them: the id is
   then kept as taken, and a request taken before is refused as `replay`. If
   handling them failed, it **releases** them, and the provider's next delivery
   is taken again. A handler that died releases nothing, but its lease runs
   out, and the delivery after it is taken.

While an id is reserved, another delivery of the same request is refused as
`pending`, with 503, so that the provider tries again later rather than lose an
event whose first handler might still fail. Delivery is at least once: an
application whose handler fails half-way handles the first events again, and
deduplicates them by their `id`.

`commit(events)` keeps only the events given: in a batch (SendGrid, Mailtrap,
Azure), the events handled are taken, and the others come back on the next
delivery. An SNS message of several recipients is kept once all its events
are committed.

`replayStore` is required where a verifier keeps ids:
`createMemoryReplayStore()` in one process; for several processes, or a
function that makes its verifier for each request, a store they share; `null`
for an application that deduplicates the events by their `id` itself. A shared
store implements three methods. The ids it is given are the provider and a
SHA-256 of the provider's id (`mailtrap:3q2+7w…`), as some ids name a
recipient. The ids of a batch go to it up to 64 at a time, so a store must
take calls that run at once, as a Redis client does by pipelining them:

```js
// Redis, with node-redis: an atomic reservation, a commit, and a release
// that frees a reservation only, never a committed id.
const RELEASE = "if redis.call('get', KEYS[1]) == 'pending' then return redis.call('del', KEYS[1]) end";
const replayStore = {
  async reserve(id, leaseMs) {
    if (await redis.set(id, 'pending', { NX: true, PX: leaseMs })) return 'reserved';
    return (await redis.get(id)) === 'done' ? 'done' : 'pending';
  },
  async commit(id, ttlMs) {
    await redis.set(id, 'done', { PX: ttlMs });
  },
  async release(id) {
    await redis.eval(RELEASE, { keys: [id] });
  },
};
```

| Option | Default | |
| --- | --- | --- |
| `replayStore` | required | The ids taken, or `null`. |
| `leaseMs` | 30 seconds | How long an id stays reserved while it is handled: longer than a handler takes, shorter than the provider's first retry (20 seconds for SNS). |
| `toleranceMs` | 5 minutes (an hour for SES) | How far from now a request may be signed. A verifier whose provider signs no time (Postmark, Brevo, Mailjet, SparkPost, SMTP2GO, MailerSend, Mailtrap, Maileroo, Azure) refuses it, and `now`. |
| `maxBodyBytes` | 5 MiB | The longest body taken. |
| `now` | `Date.now` | The clock of `toleranceMs`. |
| `onVerify` | | Hears each request: `{ provider, status, reason, events, durationMs }`, `status` being `taken`, `refused` or `error`, for a metric of refusals by `reason`. |

## Amazon SES

SES publishes its events to an SNS topic, which posts them to the webhook.
`createSesWebhookVerifier` takes a message only from a topic in `topicArns`,
signed (SignatureVersion 1 or 2) with the certificate of an
`https://sns.<region>.amazonaws.com/SimpleNotificationService-….pem` URL, with
no query, which it reads once through `fetch` and keeps; within an hour, as
SNS retries a delivery with the time it first published it; and once, by its
`MessageId`. A topic set to sign with version 2 takes `signatureVersions:
['2']`, so that a message signed with SHA1 is refused. A certificate is read
within `certificateTimeoutMs` (10 seconds), and at most four at once: a
message that needs a fifth is refused with 503, for SNS to send it again.

A subscription message is verified and handed back as `confirmation`, with
`subscribeUrl` to fetch when the application wants the subscription; nothing is
confirmed for it. A bounce is `hard` when SES says Permanent, `soft` when
Transient; a reject or a rendering failure is `rejected`. The `category` tags
of the message are its `tags`, as `./ses` sends them, and its other tags its
`metadata`.

## Resend

```js
const resend = createResendWebhookVerifier({
  secret: process.env.RESEND_WEBHOOK_SECRET,
  replayStore,
});
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
  replayStore,
});
```

Turn on the Signed Event Webhook in SendGrid and pass its verification key
(base64, as SendGrid shows it, or PEM). The signature is ECDSA P-256 over the
timestamp and the body. SendGrid posts events in batches: each event is taken
once by its `sg_event_id`, so a batch sent again keeps only what is not
committed, and is refused as `replay` when nothing is left. A `bounce` is hard, a `blocked` one soft; a
`dropped` message is `rejected`; an unsubscribe is `unsubscribed`. The
categories are the tags of the message and its custom arguments its metadata;
`messageId` is the `X-Message-Id` of the receipt, without the filter SendGrid
adds after it.

## Mailgun

```js
const mailgun = createMailgunWebhookVerifier({
  signingKey: process.env.MAILGUN_WEBHOOK_SIGNING_KEY,
  replayStore,
});
```

The signature is the HMAC-SHA256 of the timestamp and the token of the body,
with the HTTP webhook signing key; the token is taken once. Mailgun signs
neither the body nor the event in it, so a timestamp, token and signature
seen once can carry any event until the token is taken: give every process
the same shared `replayStore`, as one store per process takes the same token
once in each. A permanent
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
signed, nothing holds a request to a window or takes it once, and it needs no
`replayStore`: deduplicate by the `id` of the events. A bounce is read by its type: `HardBounce` is hard,
`SoftBounce` soft, `Transient` deferred, `SpamComplaint` a complaint,
`ManuallyDeactivated` a rejection.

## MailerSend and Mailtrap

```js
const mailersend = createMailerSendWebhookVerifier({
  secret: process.env.MAILERSEND_WEBHOOK_SECRET,
  replayStore,
});
const mailtrap = createMailtrapWebhookVerifier({
  secret: process.env.MAILTRAP_WEBHOOK_SECRET,
  replayStore,
});
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

## Lettermint and Maileroo

```js
const lettermint = createLettermintWebhookVerifier({
  secret: process.env.LETTERMINT_WEBHOOK_SECRET,
  replayStore,
});
const maileroo = createMailerooWebhookVerifier({
  secret: process.env.MAILEROO_WEBHOOK_SECRET,
  replayStore,
});
```

Lettermint signs the time and the body: `X-Lettermint-Signature: t=…,v1=…`, the
HMAC-SHA256 of `t.body` with the secret as it is given, `whsec_` and all; a
request is taken within five minutes and once by the `id` its retries keep.
Maileroo signs the body alone, in `x-maileroo-signature`, so each event is
taken once by its `event_id`, kept a day and an hour; its message id is the
reference of the message, the receipt's id, and an event names its recipients,
one event each.

## SMTP2GO

```js
// The webhook URL in SMTP2GO: https://hook:s3cret@example.com/webhooks/smtp2go
const smtp2go = createSmtp2goWebhookVerifier({ username: 'hook', password: 's3cret' });
```

SMTP2GO signs nothing, so its webhook URL carries Basic credentials, which the
verifier requires. The body may be JSON or a form, as the webhook is set up.
The message id is the `email_id` of the receipt; the metadata comes back from
`X-Metadata-<key>` fields when the webhook adds the headers of the email to its
payload.

## Azure Communication Services

```js
const azure = createAzureWebhookVerifier({ token: process.env.EVENT_GRID_TOKEN, replayStore });

app.post('/webhooks/azure', express.raw({ type: '*/*' }), async (req, res) => {
  const delivery = await azure.verify({ body: req.body, headers: req.headers });
  if (delivery.validation) {
    return res.json({ validationResponse: delivery.validation.validationCode });
  }
  try {
    for (const event of delivery.events) await deliveries.record(event);
    await delivery.commit();
  } catch (error) {
    await delivery.release();
    throw error;
  }
  res.sendStatus(200);
});
```

The email events of Azure come through an Event Grid subscription to the
Communication Services resource, in the Event Grid schema. Event Grid signs
nothing, so give the subscription a secret delivery property: `Authorization`
with `Bearer <token>`, or a header of your own with `header`. Every
notification must carry it; each event is taken once by its id. The
validation of a new subscription carries no event and is handed back for the
application to answer, its token checked when it carries one; its
`validationUrl`, for a validation by hand, must be on `*.eventgrid.azure.net`
over HTTPS, or the request is refused. Delivery reports are `delivered`, `bounced`,
`rejected` (Suppressed) or `deferred` (Quarantined); engagement reports
`opened` or `clicked`. The message id is that of the send operation, the
receipt's.

## Scaleway

```js
const trustChain = fs.readFileSync('scaleway-sns-trust-chain.pem', 'utf8');
const scaleway = createScalewayWebhookVerifier({
  topicArns: ['arn:scw:sns:fr-par:project-…:tem-events'],
  trustChain,
  replayStore,
});
```

Scaleway's Topics and Events posts the events of Transactional Email as SNS
messages, verified as those of SES are, from a listed topic, within an hour and
once, but with a certificate on a Scaleway host that must have been issued by
Scaleway's SNS trust chain. Download that chain once, from
`https://messaging.s3.fr-par.scw.cloud/fr-par/sns/sns-trust-chain.pem`, and pass
it as `trustChain`: the verifier trusts no certificate the chain did not issue.
A subscription confirmation is handed back, as for SES.

## Providers without a verifier

- **ZeptoMail:** its documentation mentions a webhook authentication key
  without describing for ZeptoMail how a request is signed, so there is no
  verifier yet.
- **Plunk:** Plunk posts no events of the messages it sends.
- **Cloudflare:** Email Service publishes its events to a Cloudflare Queue,
  which a Worker or an HTTP pull consumer reads, not to a webhook.
