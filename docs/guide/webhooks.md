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
