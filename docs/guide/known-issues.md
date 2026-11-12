# Known issues

The transport layer is ported from [upyo](https://github.com/dahlia/upyo) 0.7.0 and keeps its
behavior, bugs included, until each bug is fixed on its own with a test. This page lists the ones
still open; the fixed ones are in the [changelog](https://github.com/Alexis-Technologies/mailer/blob/main/CHANGELOG.md).

## HTTP providers and JMAP

- JMAP on Node 24: an authentication rejection (401) during the upload of a raw message whose
  size is not known ahead becomes a retryable network error, as Node's `fetch` reports an early
  answer to a streamed body so. Requests, and raw messages of a known size up to 4 MiB, go from a
  buffer and are not affected.

## The channels

- A 5xx may come once the provider took the message. Without an idempotency key, a transport
  does not send the message again after a 5xx; the receipt is of unknown delivery
  (`deliveryUnknown`). A 503 of an SMS API (Twilio, Vonage, Infobip, Sinch, AWS SMS, AlphaSMS)
  says that nothing was taken, so the transport sends it again. Three transports send again
  after any 5xx:
  - FCM, which asks for its 500 and 503 to be retried;
  - Web Push;
  - SMS Club, which refuses the same SMS within two minutes with a 453, so the retry is
    reported as of unknown delivery instead of going out twice.

  So an FCM or Web Push notification may arrive twice when the push service answered with a
  5xx after taking it.

- `accepted` is the last state a receipt of a channel reaches in 2.0. The verifiers of the
  webhooks of the channels, by which a delivery, a failure or a read comes back, ship in 2.1, so
  until then a message that ends `accepted` (an SMS, WhatsApp, RCS, Viber, a Workflows webhook
  of Teams) has no later state unless your own handler of the provider's callbacks records one.
  The work chats and the pushes end at `sent`, as their providers tell no delivery; a webhook
  of Slack, Discord or Teams, or a push with no `Location`, has an id of the transport's own
  (`webhook:<uuid>`), which no event will name.
- The default `graphVersion` of `./meta` is `v23.0`, of May 2025. Meta keeps a version of the
  Graph API about two years, so the default is raised in a minor of 2.x before it ends; pass
  `graphVersion` to move earlier.

## Deno

- Deno's `fetch` (2.9.6) sends a request again when a reused HTTP/1.1 connection closes before
  its answer. When the provider took the request before the connection was lost, the message
  goes twice; on Node and Bun the same failure is reported as of unknown delivery
  (`deliveryUnknown`) and not retried. Pass the HTTP transports and JMAP a `fetch` on a client
  that keeps no idle connection, `Deno.createHttpClient({ poolMaxIdlePerHost: 0 })`, as
  [getting started](/guide/getting-started#bun-and-deno) shows. The providers that take an
  idempotency key, which the transport sends with every message (Resend, Lettermint, Brevo,
  Azure), see the second request as the first and do not send the message again.
- The same holds for the transports of the channels, which take a `fetch` alike: an SMS or a
  chat message may go twice through those whose API takes no key (Twilio, Vonage, Infobip,
  Sinch, AWS SMS, AlphaSMS, SMS Club, Telegram, Slack, Viber, Meta, FCM, Web Push, the webhooks of
  Discord, Teams and Google Chat). Those that send a key the provider dedupes by do not: a bot
  of Discord (its nonce), RCS Business Messaging (its `messageId`), a Chat app of Google (its
  `requestId`) and TurboSMS (its `sequence_id`). APNs goes over `node:http2`, not `fetch`, and
  is not affected.
