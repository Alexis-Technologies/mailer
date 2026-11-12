# Changelog

All notable changes to **`@alexify/mailer`** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The channels: SMS, RCS, WhatsApp, Messenger, Instagram, Telegram, Viber, Slack, Discord,
Teams, Google Chat and push go through the transports, the decorators, the queue and the
audit of email, under one model of messages. A major, so that there is one name for each
thing rather than one for email and one for the channels; what a store, a log of audit or a
worker of 1.2 holds reads the same.

### Upgrading from 1.x

- **Import each webhook verifier from its own entry:** `require('@alexify/mailer/webhooks')`
  of `createSesWebhookVerifier` becomes `require('@alexify/mailer/webhooks/ses')`, and so on
  for the fifteen providers; the names, options and results are those of 1.x.
  `createMemoryReplayStore` and `WebhookVerificationError` stay in `./webhooks`.
- **Rename the API of `./queue`:** `createMailQueue` → `createQueue`, `createMailJobHandler` →
  `createJobHandler`, `prepareMailJob` → `prepareJob`, `parseMailJob` → `parseJob`,
  `MailQueueError` → `QueueError`, `MAIL_JOB_NAME` → `EMAIL_JOB_NAME`, `MAIL_JOB_VERSION` →
  `EMAIL_JOB_VERSION`, and the types without `Mail` (`MailJobData` → `JobData`, `MailQueue` →
  `MessageQueue`, `MailWorkerOptions` → `JobHandlerOptions`); in `./bullmq`,
  `BullMQMailJobOptions` → `BullMQJobOptions`, `BullMQMailWorkerOptions` → `BullMQWorkerOptions`.
  The `queue.*` codes, the options and the behavior do not change.
- **Update dashboards and alerts:** the metrics are `mailer.message.*` (was `mailer.email.*`,
  and `mailer.email.message.size` is `mailer.message.size`) with `mailer.channel`, the priority
  attribute `mailer.priority` (was `email.priority`); the events of `./logger` are `message.*`
  (was `email.*`); the logger sink of `./audit` writes `message.<state>` (was `mail.<state>`);
  a span is named by its channel (`email send`) unless `spanPrefix` says otherwise.
  The metrics of the queue (`mailer.queue.jobs`, `mailer.queue.job.duration`) take
  `mailer.job.outcome` and `mailer.job.code` (were `outcome` and `code`), the names of the
  attributes of its span.
- **Cover the new members of the unions** in an exhaustive `switch`: the seven categories of the
  channels in `ReceiptErrorCategory`, `sent`, `read`, `failed`, `expired` and `subscribed` in
  `DeliveryEventType`, `sent`, `read` and `expired` in `MessageState`. A `DeliveryEvent` built
  by hand sets `channel` (`'email'`).
- **Nothing persisted changes:** an email job of 1.2 (its JSON, hash, MAC, id, Message-ID and
  Content-IDs), the ids of audit events, the ranks of states in MongoDB and the keys of
  `./idempotency` are the same bytes, so workers of 1.2 and 2.0 can share a queue of email
  while they are replaced, and a key enqueued before the upgrade is a duplicate after it.
- **Give the channels a queue of their own** (another `queueName` of BullMQ, another collection
  of the outbox): a worker of 1.2 that meets a job of a channel releases it as
  `unsupported_version`, and it waits there until a worker of 2.0 takes it.
- **A message built by hand without `channel` is still email** at run time; its type now asks
  for `channel: 'email'`, which `createMessage` sets.

### Changed

- **Breaking: one model of messages for every channel.** `Message` has `channel: 'email'`,
  which `createMessage` sets; a message without one, built by hand for 1.x, is still read as
  email. The root gains the types of the twelve other channels (`SmsMessage` to
  `PushMessage`, `ChannelMessage`, `AnyMessage`, `MessageOf<C>`, `Channel`), and `Transport`
  and `VerifiableTransport` take the type of their messages as a second parameter,
  `Message` by default, so that a transport of SMS takes no email and an email transport no
  SMS.
- **Breaking: the unions of the root are wider,** so a `switch` over one that was exhaustive is
  not: `ReceiptErrorCategory` has `invalid-recipient`, `opted-out`, `outside-window`,
  `blocked`, `not-on-channel`, `unregistered` and `unreachable`, which only the providers of
  the channels give, by their codes (no words of an error lead to them, so no failure of
  email is classified anew), each retryable by its category (`unreachable` alone);
  `DeliveryEventType` has `sent`, `read`, `failed`, `expired` and `subscribed`, and
  `MessageState` `sent`, `read` and `expired`.
- **Breaking: a delivery event names its channel,** `channel` required in `DeliveryEvent`:
  `email` for the fifteen verifiers of `./webhooks`.
- **Breaking: the events of `./logger` are `message.sending`, `message.sent`,
  `message.failed` and `message.retrying`** (were `email.*`), each with the `channel` of its
  message (`email` for an email and raw MIME), and their texts name a message (`Sending
  message.`). A message of a channel is logged with `recipientCount`, `mediaCount`,
  `buttonCount`, `hasTemplate`, `hasPayload` and `priority`, where its properties threw, its
  recipient only within the message of `recordMessage`, and `inline` writes its text; without
  `recordMessage`, the text of a failure or a retry is redacted of the recipient as the message
  names it (a chat id, a push token, an endpoint). `LoggerTransport<P, TMessage>` takes the
  messages of the transport wrapped.
- **Breaking: the logger sink of `./audit` writes `message.<state>`** (was `mail.<state>`),
  with the `channel` of the message, `email` for an event of 1.x, which names none.
- **Breaking: the metrics of `./otel` are `mailer.message.*`** (were `mailer.email.*`):
  `attempts`, `duration`, `messages`, `retries`, `size` (was `mailer.email.message.size`),
  `attachments`, `active_sends` and the new `segments` (of an SMS, as its receipt counts them),
  each with `mailer.channel`, and the priority is `mailer.priority` (was `email.priority`). A
  span is named by the channel of its message (`email send`, `sms send`) unless `spanPrefix` is
  set, whose default is no longer `email`; a batch by the channel its messages share
  (`message send_batch` for several). A message of a channel, whose size read its subject and
  threw, has a span of its own attributes (`mailer.channel`, the length of its text, its media,
  the segments and encoding of an SMS, its tenant, its sender only with `recordSensitiveData`,
  its recipient never) and events (`message.sent`, `message.send_failed`), and its error text is
  redacted of its recipient as it names it. A span of email adds `mailer.channel` and
  `mailer.tenant.id`; its other attributes are those of 1.x. `OpenTelemetryTransport<P,
  TMessage>` takes the messages of the transport wrapped.
- **Breaking: the API of `./queue` names no mail.** `createMailQueue` is `createQueue`,
  `createMailJobHandler` `createJobHandler`, `prepareMailJob` and `parseMailJob` are
  `prepareJob` and `parseJob`, and `MailQueueError` is `QueueError`, with the same `queue.*`
  codes; `MAIL_JOB_NAME` and `MAIL_JOB_VERSION` are `EMAIL_JOB_NAME` and `EMAIL_JOB_VERSION`.
  The types lose `Mail` likewise (`MailJobData` is `JobData`, `MailQueue` is `MessageQueue`,
  `MailWorkerOptions` is `JobHandlerOptions`, `MailEnqueueResult` is `EnqueueResult`,
  `MailQueueStats` is `QueueStats`), and the texts of its errors and warnings name a queue and
  a worker. An email job keeps its name, `mail`, and its bytes.
- **Breaking: the option types of `./bullmq` name no mail:** `BullMQMailJobOptions` is
  `BullMQJobOptions` and `BullMQMailWorkerOptions` `BullMQWorkerOptions`.
- **Breaking: each verifier of `./webhooks` is an entry of its own,** `./webhooks/<provider>`
  named as its transport (`./webhooks/ses`, `./webhooks/resend` … `./webhooks/scaleway`), with
  the name, options and behavior of 1.x, so that a function that verifies one provider loads the
  request layer and that provider (5 to 7.5 KB min+gzip) rather than all fifteen (15 KB):
  `require('@alexify/mailer/webhooks')` of a verifier becomes
  `require('@alexify/mailer/webhooks/<provider>')`. `./webhooks` keeps
  `createMemoryReplayStore`, `WebhookVerificationError` and the types the verifiers share
  (`WebhookRequest`, `WebhookResult`, `WebhookVerifier`, `ReplayStore`…); each entry declares
  the options and results of its own.
- **Breaking: the types of a worker of `./queue` take every channel:** `transport` is any
  transport (of email, of a channel, a router), the context of `resolveAttachment` is that of
  an `attachment` of an email or of a `medium` of a channel (so an `attachment` is checked
  before it is read), and `enqueue` of an email gives an `EmailEnqueueResult`, of a channel a
  `ChannelEnqueueResult`, `EnqueueResult` being either.

### Added

- **`tenantId` of a message,** 1 to 256 characters without control characters, as a job takes
  it. No provider is sent it; the fingerprint of a message and the keys of `./idempotency`
  leave it out, so that a job 1.2 began to send finds its key after the upgrade.
- **The states of the channels in `./audit`:** `sent` ranks between `accepted` and
  `delivered` (3.5), `expired` with `failed` (4) and `read` after `delivered` (4.5), so that
  the ranks a store keeps from 1.2 stay; `read` and `expired` are final. `sent`, `read`,
  `failed` and `expired` delivery events become those states, and an audit event takes the
  `channel` of a delivery event that is not email. The logger sink writes `sent` and `read` at
  info, `expired` at warn.
- **`./channels`, the messages of the channels:** `createChannelMessage` checks and copies a
  message of any of the twelve (a recipient of the channel's kind, media, buttons, mentions, a
  payload of JSON, a WhatsApp template, the fields of another channel refused),
  `checkChannelMessage` checks a copy again, and `isChannelMessage` tells one from an email.
  `normalizePhone` gives E.164 from the way people write a number, a national one by the trunk
  prefix and calling code of `defaultCountry` (ITU-T E.164, no library of numbering plans), and
  `isE164` checks one. `countSegments` counts the segments of an SMS (GSM-7 with its extension,
  UCS-2 by code unit, 160/153 and 70/67, no character split; the tables and cases of Twilio's
  message-segment-calculator and of split-sms). `escapeTelegramHtml`, `escapeSlackText`,
  `escapeDiscordMarkdown` and `neutralizeMentions` put text into the markup of a chat as text.
- **`./router`, a transport of every channel:** `createRouter({ email, sms, telegram, … })`
  sends each message through the transport of its `channel` (none is email), a channel
  without a route failing as `unsupported`; `sendMany` gives the messages of a channel that
  come in a row to its transport's `sendMany`, the receipts in order; `verify` checks each
  route, and disposal disposes of each transport once.
- **Phone numbers are redacted with the addresses:** every text that went through
  `redactAddresses` (the records and spans of the decorators, the warnings, the retries of the
  HTTP providers, the reasons the queue writes into its store and its audit, the drivers of
  BullMQ and of a source) has its phone numbers in E.164 replaced by `[REDACTED]` too; and the
  credentials of the channels (`authToken`, `botToken`, `webhookUrl`, `signingSecret`,
  `vapidPrivateKey`, `serviceAccount` and the fields of its JSON, the headers of Viber and Google)
  are redacted from an inspected or serialized transport by their names.
- **What a receipt tells of a channel:** `channel`, `segments` (the parts of an SMS) and
  `state` (`sent` for a channel that reports no delivery); a delivery event its `error`, and an
  audit event its `channel`.
- **`./mock` takes the messages of the channels:** `getMessagesTo` matches the `to` of one (a
  number or an id, or the token, topic, endpoint or conversation it names), where it threw;
  `getMessagesByChannel` gives the messages of a channel; `getMessagesBySubject` looks at email
  alone, where a message of a channel matched `undefined`. `MockTransport<TMessage>` takes email
  by default.
- **`./pool` stops its failover at a recipient no provider of the channel would reach:**
  `invalid-recipient`, `opted-out`, `outside-window`, `blocked`, `unregistered` and
  `not-on-channel`, as at `validation` and `rejected`, where an opted-out number went through
  every provider of the pool; `unreachable` fails over, as another route may reach the handset.
  `PoolTransport<P, TMessage>`, its entries, selectors and strategies take the messages of one
  channel, and a pool of transports of several channels is a type error (a `./router` sends
  them). The categories are in the guide of a custom transport.
- **`./idempotency` takes the messages of the channels:** a message of a channel, whose
  fingerprint threw, is told from another by its channel, recipient, text, media, buttons,
  payload and the rest (never its tenant or its key), so that two SMS of another text under one
  key are one sent and one refused. `IdempotencyTransport<P, TMessage>` and its `key` take the
  messages of the transport guarded.
- **The types of `./retry`, `./breaker`, `./ratelimit` and `./tee` take the messages of a
  channel,** a second parameter `TMessage`, email by default, as their runtime did already:
  `./retry` retries `unreachable` alone of the categories of the channels, and `./breaker`
  counts none of them against a provider.
- **`./hooks` takes the messages of the channels:** a copy `beforeSend` returns of one is
  checked again as `createChannelMessage` checks it, where every such copy was refused as
  `rejected`, which also stopped the failover of a pool. `HooksTransport<P, TMessage>` and
  `Hooks<TMessage>` take the messages of the transport wrapped.
- **`./telegram`, the Bot API of Telegram:** a text by `sendMessage`, one medium by the method
  of its type with the text as its caption, an album of up to ten by `sendMediaGroup`, a URL or
  a `file_id` as it is and bytes as a file of a form; buttons as an inline keyboard, `thread` a
  topic of a forum, a `low` priority without sound, `parseMode` (`HTML`, `MarkdownV2`) and the
  `payload` of the call. A refusal is told by its description (`blocked`, `not-on-channel`,
  `invalid-recipient`, a 429 retried after its `retry_after`); a 5xx or a timeout is of unknown
  delivery, never sent again, as the Bot API has no idempotency key; the receipt says `sent`,
  its id `<chat>:<message_id>`. What Telegram would refuse (a text over 4096 characters, an
  album with buttons) fails before any request.
- **`./slack`, chat.postMessage and incoming webhooks:** a message with `to` goes through the
  Web API with the token of a bot, one without it to the channel of the webhook, whose URL is
  its credential and never shown in an error. Its text is mrkdwn, its mentions of a whole
  channel, of users and of groups neutralized unless its `mentions` name them; `thread` is
  `thread_ts`; buttons and pictures at a URL become Block Kit; `payload` the fields of the
  body. An `ok: false` is told by its error (`not_in_channel` is `not-on-channel`, an
  archived channel `invalid-recipient`), a `fatal_error`, a 5xx or a lost answer is of unknown
  delivery and never posted again; the receipt says `sent`, its id `<channel>:<ts>`.
- **`./discord`, the REST API of a bot and webhooks:** a message with `to` is created by the bot
  under a nonce of its `idempotencyKey` that Discord enforces, so that it is retried safely after
  a timeout or a 5xx; one without it goes to the webhook (`?wait=true`, `thread_id`), never sent
  again after an ambiguous answer. No mention notifies unless the message names it
  (`allowed_mentions` is `{ parse: [] }`); buttons are components, pictures at a URL embeds,
  bytes files, a `low` priority a silent message. A send waits for the bucket of its route
  (`X-RateLimit-*`), a 429 its `retry_after`; a refusal is told by its JSON code.
- **`./fcm`, Firebase Cloud Messaging HTTP v1:** a push to a token or a topic, its title and
  text as the notification, one picture, its data (FCM's own keys refused before any request),
  and its priority and `expiresAt` on Android, APNs and Web Push alike; `payload` merges over
  the message key by key. The token of the service account is asked for once and shared, and
  dropped when FCM refuses it. An error is told by the `errorCode` of its FcmError first
  (`UNREGISTERED` and a malformed token are `unregistered`); a lost answer is of unknown
  delivery, never sent again; `verify()` is a dry run.
- **`./webpush`, Web Push on `node:crypto` alone:** a push to the subscription of a browser,
  encrypted as one record of aes128gcm (RFC 8291, the vector of its §5 in the tests) and signed
  with VAPID (RFC 8292, a JWT held per origin of a push service). The service worker reads JSON
  of its title, text, picture, data and buttons (`actions`) with the fields of `payload`;
  `payload.topic` is its `Topic`, `expiresAt` its `TTL`, the priority its `Urgency`. A push of
  more than 3993 bytes is refused before any request, an endpoint that is not a public HTTPS
  URL (`allowEndpoint` to replace the check) or keys not of P-256 are `invalid-recipient`, and a
  subscription gone (404, 410) is `unregistered`. The VAPID keys are checked when the transport
  is made.
- **`./meta`, WhatsApp, Messenger and Instagram over the Graph API:** a block per channel, each
  with its number, page or account and its token. WhatsApp sends a text, one medium, a `template`
  it approved, or interactive buttons (three replies or one link), its correlation id as
  `biz_opaque_callback_data`; Messenger and Instagram a text or an attachment, buttons as a
  button template or quick replies, as a `RESPONSE` unless the payload tags it. An error is told
  by its code and subcode: a recipient not on WhatsApp is `not-on-channel`, a message outside
  the 24-hour window `outside-window`, a user who stopped marketing `opted-out`. The receipt
  says `accepted`; `graphVersion` is `v23.0` by default.
- **`./twilio`, SMS, MMS, WhatsApp and RCS over the Messages API:** the recipient with the
  prefix of its channel, the sender of its channel or the Messaging Service, media as the URLs
  of an MMS, a template of the Content API by its ContentSid, `expiresAt` as `ValidityPeriod`,
  and the correlation id in the query of `StatusCallback`; an auth token or an API key, a
  region and an edge from Twilio's lists. An error is told by its code (`codes.js`: a STOP is
  `opted-out`, 63016 `outside-window`, 21612 `unreachable`); the receipt says `accepted`, with
  the `segments` Twilio counted.
- **`./aws-sms`, AWS End User Messaging SMS:** `SendTextMessage` signed with SigV4 at each
  attempt, with credentials or a function that gives them (those of a role); the origination
  identity, the type by the priority, `expiresAt` as `TimeToLive`, the configuration set, and
  the `metadata` as the `Context` its events give back. An error is told by its reason (a
  number opted out is `opted-out`, a destination not verified in the sandbox `configuration`),
  then its type; the receipt says `accepted`, with the segments counted.
- **`./vonage`, the SMS API of Vonage:** an SMS as `unicode` when it is no text of GSM-7,
  `expiresAt` as its `ttl`, the correlation id as its `client-ref`; every part of the answer
  is read, the receipt's segments the `message-count`, a refused part its status (7 a number
  barred is `opted-out`), of unknown delivery when an earlier part went.
- **`./infobip`, the SMS API of Infobip:** `/sms/3/messages` with the `App` key, the base URL
  the host of the account or a URL; `expiresAt` as the validity period, the correlation id as
  `callbackData`; a status of the groups REJECTED, UNDELIVERABLE or EXPIRED in the 200 fails
  the message by its name (`REJECTED_DND` is `opted-out`), and the receipt's segments are the
  `messageCount` of the answer.
- **`./sinch`, the SMS API of Sinch:** a batch of one recipient a message, on the host of its
  region (`us`, `eu`, `au`, `br`, `ca`) with the token of the service plan; `expiresAt` as
  `expire_at`, the correlation id as `client_reference`, and reports per recipient to a
  `callbackUrl` of the transport's.
- **`./apns`, the Apple Push Notification service:** pushes over one HTTP/2 session of its
  origin (`internal/http2.js`), with the ES256 token of the team signed once for 55 minutes and
  shared, and made anew once when APNs says it expired; the environment named, never read from
  `NODE_ENV`; a push of data alone a background one with priority 5; a 5xx of unknown delivery,
  never retried; `Unregistered` is `unregistered`, and the `apns-id` the receipt's id.
- **`./rbm`, Google's RCS Business Messaging:** a message of RCS from an agent, its text, one
  medium by URL (a standalone rich card with a text), its buttons as suggestions; a messageId
  of the idempotency key, which the API takes once, so a lost answer is sent again under it; a
  user without RCS is `not-on-channel`, and the token of the service account is shared as
  `./fcm` shares its.
- **`./viber`, the REST Bot API of Viber:** a text or a picture to a user subscribed to the
  bot, its buttons as a keyboard, the correlation id as `tracking_data`; the `status` of the
  200 fails the message (5 and 6, a user not on Viber or not subscribed, are `not-on-channel`),
  and the `message_token`, a 64-bit integer, keeps every digit.
- **`./teams`, Microsoft Teams:** a message to a channel through a webhook of Workflows, as an
  Adaptive Card (its text, a picture, its buttons as actions), whose 202 is `accepted`; or to a
  conversation through a bot of the Bot Framework, with the token of its app (client
  credentials) sent only to a service URL of Teams or of `serviceUrls`; a bot removed from the
  conversation is `blocked`, and a 5xx of unknown delivery.
- **`./google-chat`, Google Chat:** a message to the space of a webhook, or to a space of a Chat
  app with the token of its service account and a `requestId` of the idempotency key, which
  the API answers again with its message, so a lost answer is sent again; `<users/all>` and a
  mention the message does not name are broken, a picture and links are a card, and `thread`
  the key of the thread.
- **`./turbosms`, TurboSMS:** SMS and Viber to a phone number, a hybrid of Viber with an SMS by
  `sms` in the payload; each send under a `sequence_id` TurboSMS executes once, so a lost
  answer is sent again; the `response_code` of the 200, then of its recipient, fails the
  message (404, the stoplist, is `opted-out`).
- **`./alphasms`, AlphaSMS:** SMS and Viber to a phone number through its JSON API, a hybrid by
  `type: 'viber+sms'` in the payload; the `success` of the 200, then of its item, fails the
  message by the words of its error, and the receipt's segments are its `parts`.
- **`./smsclub`, SMS Club:** SMS through its JSON API with the token of the account, the id of
  the SMS the key of the `info` of the answer; a refusal told by its status (453, the same SMS
  within two minutes, is `rejected`).
- **`./queue` takes the messages of the channels:** `enqueue({ channel: 'sms', kind:
  'content', to, text })` makes a job of version 2, checked as `createChannelMessage` checks
  its message (a phone in E.164 by the `defaultCountry` of the queue), its id derived from its
  key and its channel, named by its channel, its channel sealed with its other fields by a
  codec, never beside them, so that a worker of 1.2 waits for it (`queue.unsupported_version`)
  rather than failing it. A template renders its text (from its HTML when it gives none), its
  subject the title of a push; the template WhatsApp approved is `providerTemplate`; media go
  as a URL, an id, their bytes or a `ref` that `resolveAttachment` resolves to content or a URL;
  `expiresAt` is passed on with the message. Its audit events carry `channel` and no
  Message-ID, `sent` follows `accepted` for a receipt that says so, and `enqueue` gives its
  `channel` in place of a `messageId`. An email job is that of 1.2 byte for byte. The channels
  are best given a queue of their own (the guide says why).
- **An email a worker of `./queue` builds carries the `tenantId` of its job,** as one of a
  channel does, for the decorators that read it (a rate limit per tenant, a span); no provider
  is sent it, and its fingerprint is that of 1.2.
- **`instrumentHandler` of `./otel` names the channel of a job:** its span and each metric of
  the queue (`mailer.queue.jobs`, `lag`, `job.duration`, `redeliveries`) carry
  `mailer.channel`, `email` for an email job, the name of a sealed job of a channel, none for a
  job of no known channel.
- **A receipt of unknown delivery tells why:** `deliveryUnknownReason` is `timeout`,
  `lost-answer`, `server-error`, `unreadable-answer`, `no-id`, `duplicate` or `in-flight`
  (`DeliveryUnknownReason`), for every transport of email and of the channels, so a message
  to reconcile is told from one that most likely went.
- **`./otel` counts a message of a channel by the state its provider took it in:**
  `mailer.message.messages` carries `mailer.message.state`, `accepted` when its delivery comes in
  the events of the provider, `sent` when none will.
- **`./bullmq` tells the channel of a job it gives up:** the `delivery_unknown` event of a job
  of a channel that stalled too often carries its `channel`, read from its name when it is
  sealed; that of an email names none, as in 1.x.

### Fixed

What the review of 2.0 found that an email of 1.x meets too (the fixes of the code of the
channels, which 1.x has not, are in the commits and in `CLAUDE.md`):

- **A request that failed before it was sent is not of unknown delivery:** a provider whose
  credentials or token could not be had, or a header field `Headers` refused, left a receipt of
  unknown delivery, which a queue never retries, though nothing went; it is marked unsent, and
  the error of a refused header field no longer prints its value, which could be a credential.
- **A base URL with a user or a password is refused when the transport is made,** where `fetch`
  refused it at the first send with an error that printed the URL whole.
- **`fromUrl` and the endpoints of Web Push refuse SIIT, Teredo and the reserved IPv6 ranges**
  (`::ffff:0:0:0/96`, `2001::/32`, `100::/64`, `2001:db8::/32`, `3fff::/20`).
- **A refusal that `verify()` reads in a 2xx is thrown at once,** not retried as a read.
- **A sealed job carries no field outside its hash and its MAC:** a key `__proto__` in what a
  codec opens, which made the fields under it inherited, so read by the worker though neither
  checked, is refused, and so is data that inherits fields.
- **Under `signingKeys` an unsigned job is failed at once:** one that claimed a later version
  or held a field the worker does not know was given back as `queue.unsupported_version` for
  a week; the signature is now checked first, and fails it as `queue.signature_invalid`.

## [1.2.1] - 2026-11-07

A patch of 1.2.0: bugs found while planning 2.0, each with a test that fails without its fix.
Nothing changes for a message, a job or what a store holds.

### Fixed

- **A bug of a transport behind `./pool` was failed over and hidden:** a `TypeError` such as
  reading a property of `undefined` became an error of the receipt, and one that struck after the
  message went out sent it again through the next transport. It rejects the send, as `./retry`
  does; a network failure that `fetch` reports as a `TypeError` still fails over.
- **`./breaker` threw a `TypeError` for a failed receipt without `errors`,** which the type of a
  receipt allows and a transport of the application may give, so the send rejected and its
  receipt was lost. Such a receipt is judged by the category `classifyReceiptError` gives each of
  its `errorMessages`.
- **Records named the addresses of an error's text:** those of the polling driver
  (`queue.reserve_failed`, `queue.lease.extend_failed`, `queue.settle_failed`), the outbox's
  `queue.change_stream_failed`, the BullMQ driver's `queue.worker.error` and `queue.job.lost`, and
  the pool's record of a selector that threw. They are redacted, as the warnings already were.
- **`./otel` guessed the network attributes of a span from the shape of a config:** a transport
  of the application with a `host` and a `port` was traced as SMTP, one with a `domain` to
  `api.mailgun.net`, and an `endpoint` of any scheme as HTTP. SMTP and Mailgun are told by the
  transport's id, and only an HTTP URL is HTTP; the built-in transports get the attributes they
  had.
- **`reset()` of `./mock` kept the messages of `sendRaw()`;** it clears them, as
  `clearSentMessages()` does.

## [1.2.0] - 2026-10-20

The reliability layer of the roadmap, on the transport of 1.1: a persistent queue, on BullMQ or a
transactional outbox in MongoDB, whose workers render templates of the engine the application
uses and know a permanent failure from a temporary one, and the audit of every state of a
message. Everything is additive: nothing of 1.1 changes, and the package still has no runtime
dependency, BullMQ, MongoDB and the template engines being passed in.

### Added

- **`./queue`**: `createMailQueue({ driver, audit, logger })` with `enqueue`, `enqueueMany` and
  `createWorker({ transport, renderer, resolveAttachment, checkJob, classify })`.
  - **Jobs.** A job is a template with its context, rendered by the worker, or content rendered
    already, as JSON checked when it is enqueued (`prepareMailJob`, `parseMailJob`): its fields as
    `createMessage` checks them, its context refused with the path to what JSON would change,
    attachments as bytes (bounded) or references the worker resolves. Its id is derived from the
    namespace, tenant and `idempotencyKey`, a UUID of their hash or what `deriveId(kind, seed)`
    makes of it (as for the Message-ID and Content-IDs of a job under a key; `generateId` makes
    those it draws), so the same message enqueued again is one job, and another under the key is
    refused (`MailQueueError` `queue.key_reused`, with the `jobIds`
    refused and, from `enqueueMany`, the `answers` of the other jobs, all of them enqueued and
    audited first). Its Message-ID and Content-IDs are fixed for every attempt. `scheduledAt` is a
    delay of the queue and `expiresAt` a deadline. The fields of a job of version 1
    (`MAIL_JOB_VERSION`, named `MAIL_JOB_NAME`) are fixed: a later version, or a field this one
    does not know, makes the job wait for a worker that reads it (`queue.unsupported_version`,
    given back with its attempts not spent, for a week or until it expires) rather than fail its
    hash during a rolling deploy.
  - **Security of the store.** `signingKeys` sign each job with an HMAC-SHA256 (`kid`, `mac`), and
    a worker given them sends no job they did not sign (`queue.signature_invalid`): the SHA-256 of
    a job tells a change, but whoever writes to the store can recompute it; the first key signs and
    each verifies, for rotation. A `codec` (`encode`, `decode`, such as AES-GCM under the
    application's key) seals the fields of each job, its addresses, context and attachments,
    leaving the version, hash, correlation id, signature and trace context in clear; a worker
    without it gives a sealed job back (`queue.codec_missing`), one whose codec fails retries it
    (`queue.codec_failed`). `idSecret` derives the id of a job from its key with an HMAC, so an id
    in the audit and the logs cannot be traced back to a key that names a person.
  - **The worker** (`createMailJobHandler`, for any driver) fails a permanent failure, a missing
    template or a bug at once, retries a temporary one never sooner than `Retry-After`, an
    operator's failure (`auth`, `configuration`) after five minutes, and never sends again a
    message of unknown delivery. It gives up a job whose runs ended unsettled more than
    `maxRedeliveries` (3) times, as `delivery_unknown`, so a job that kills or blocks its worker
    does not take every worker down in turn for ever; with `redelivered: 'delivery_unknown'`, a
    run again of an attempt whose run before died is of unknown delivery rather than a second send,
    unless the audit sink tells (`has`) that it died before its submit. `rateLimitScope` makes a
    rate limit wait for the job, the queue or the job's tenant. The renderer is given the job's
    `signal`; a template that fails to render leaves only its name, phase and engine in the store
    and the audit, its text in the log at `debug`. Every failure, retry and escape is logged with
    its code and duration (the codes in one table of the queue guide).
  - **Sources and drivers.** `createPollingDriver(source)` makes a driver of a store that lends its
    jobs (an outbox): it keeps the lease of a run, aborts a run whose lease the store does not
    extend before the lease runs out (`QueueLeaseLostError`), logs a settle the token fenced off
    (`queue.settle_fenced`; the settling writes of a source give `false`), and wakes one lane per
    change of its source. A job request carries its `tenantId` and a job gives back its
    `redeliveries`, never counted down. A driver declares `transactional`; one that is not refuses
    a transaction, and without one the `queued` event is told before the job, so a strict sink
    that fails leaves nothing enqueued. `AuditSink.appendMany` takes the `queued` events of an
    `enqueueMany` in one write. `traceContext` gives each job the producer's W3C `traceparent`.
  - **The memory queue**, `createMemoryQueue()`, for tests and a single process: its jobs on heaps
    (a reserve costs O(log n)), its `source` held to the same contract as the outbox
    (`tests/helpers/queue/source-contract.js`), with `stats()`, `failed()`, `retryFailed(id)` and
    `resume()`.
  - **Retention and tenants**, the same on every driver: a completed job is kept
    `dedupeWindowSeconds` (a day, its window of duplicates), a failed one `retainFailedSeconds` (a
    week), and the message of a job done with is dropped (`retainData`: `'failed'` keeps the failed
    ones, `'all'`, `'none'`), its version and hash kept so a duplicate is still told.
    `fairness: 'tenant'` (memory queue, outbox) takes a high job of any tenant first, then the
    tenants in turn, so one tenant's backlog holds no other's mail.
- **`./bullmq`**: `createBullMQDriver({ bullmq: { Queue, Worker }, connection })`, with BullMQ
  passed in: jobs under their id, priorities from 1, retention by time, the delay of each retry
  read back by a backoff strategy of the worker's, failures as `UnrecoverableError` and releases
  that spend no attempt, delays counted from the clock it is given (`now`); a batch read back 32
  jobs at once to tell its duplicates.
  `createBullMQProcessor` and `createBullMQBackoffStrategy` (of the type `MAILER_BACKOFF_TYPE`)
  serve a Worker of your own. A job BullMQ gives up itself (stalled too often) is told to the
  queue's audit sink as `delivery_unknown` (`queue.lost`). `pnpm test:bullmq` runs it on BullMQ
  and Valkey.
- **`./mongodb`**: the transactional outbox, `createMongoOutbox({ collection })`, a `QueueSource`
  in a collection of the MongoDB driver passed in.
  - A job enqueued with `{ transaction: session }` is written in that transaction (an upsert, so a
    duplicate does not abort it), lent by one atomic `findOneAndUpdate` under a token every later
    write is fenced by, and given to another worker as `redelivered` when its lease runs out,
    `clockSkewToleranceMilliseconds` (5 s) after by the taker's clock.
  - An idle poll is two round trips: leases are taken back once a third of a lease, the pauses read
    once a poll interval, and the next due time read from its own index; its optional change
    stream wakes one lane per change after which a job may be ready, and is opened again when it
    fails. `bench/outbox.js` measures it (2 round trips a job, some 2300 jobs a second for one
    worker of ten lanes on a laptop).
  - A pause of the queue or of one tenant (`rateLimitScope: 'tenant'`), and `resume()`; `stats()`
    (jobs by state, the age of the oldest job due, the pauses), `failed({ limit, after })` and
    `retryFailed(id)`; `ensureIndexes()` makes its indexes and the TTL on `expireAt`.
  - `createMongoAuditSink` (each event once by its id, in the transaction; `has`, `appendMany` in
    one `bulkWrite`, and `eventsOfProviderMessage(id)`, which finds the events a webhook filed
    under the provider's id of a message) and `createMongoIdempotencyStore` (each step atomic, for
    `IdempotencyTransport` across processes) go with it. `pnpm test:mongodb` runs them on a replica
    set.
- **`./templates`**: `createTemplateRenderer({ engine, loader, layout, partials, globals,
  defaultLocale, inlineCss })`, a `Renderer` of templates by name, over nine engines passed in
  (`createEjsEngine`, `createHandlebarsEngine`, `createPugEngine`, `createMjmlEngine`,
  `createLiquidEngine`, `createNunjucksEngine`, `createEtaEngine`, `createMustacheEngine`,
  `createReactEmailEngine`): names never paths (`createFileLoader` reads nothing outside its
  directory, `createMemoryLoader` holds them by name), variants by locale and part, the subject in
  front matter, a layout, includes read through the loader, each template compiled once, CSS inlined
  by juice or css-inline without fetching a stylesheet (`createCssInliner`), and the text derived
  from the HTML. `TemplateNotFoundError` and `TemplateRenderError` have a stable `code`.
  - **Safety.** An engine option that turns escaping off (Handlebars `noEscape`, Nunjucks
    `autoescape: false`, a Liquid `outputEscape`, Eta `autoEscape: false` or `escapeFunction`, EJS
    `escape`) throws unless the engine is given `allowUnescaped: true`. Liquid has `parseLimit`
    (1 MiB), `renderLimit` (1000 ms) and `memoryLimit` (1e8) on by default, and the guide says who
    may write a template in each engine. A render is bounded: `maxIncludes` (10000),
    `maxIncludeDepth` (32), `maxOutputBytes` (10 MiB). A loader is given template names alone,
    none with a segment starting with a dot, and the file loader reads a file through the
    descriptor its size came from.
  - **Time and failures.** `render({ ..., signal })` stops at the abort of its signal, with its
    reason, and `renderTimeoutMilliseconds` (30000) fails a render that hangs with a retryable
    `TemplateRenderError` of phase `timeout`, what it waited for read or compiled anew;
    `loader.load(name, { signal })` is told when to stop. A loader that fails is a
    `TemplateLoadError` (`MAILER_TEMPLATE_LOAD`), retryable unless its error is a bug; every error
    tells `phase`, `engine`, `template`, `requested` and `locale`.
  - **Includes.** One rule in every engine: `/x` from the root, `./x` against the template it is
    written in, a bare name from the root then the partials, with the engine's extensions; EJS and
    Mustache read nested relative includes against their own template, and a bare Pug include is
    read from the root, then the partials (`include ./footer` for the file beside).
  - **Caches and telemetry.** What each engine keeps is bounded by the renderer's cache; an EJS
    include is compiled once (`ejs.cache`, per renderer, forgotten at `clear()`), and Mustache
    parses a template once (it needs `mustache.Context`). `locales` names the locales templates
    are written in; `logger` hears `templates.compiled` and `templates.rendered` at `debug`.
  - **Fixed before release:** a Handlebars partial that names itself hung the render, and
    `./footer` of two directories was one partial; concurrent Nunjucks renders took each other's
    missing include, and `ignore missing` failed; Liquid's missing include was a
    `TemplateRenderError`; a renderer with a layout and React Email sent every message without the
    layout, which now throws when the renderer is made; the file loader refused every `load` after
    a `loadSync` when its `dir` was spelled otherwise than on disk (its case, a short name of
    Windows).
- **`./audit`**: the states of a message (`queued`, `rendered`, `submitted`, `accepted`,
  `delivered`, `bounced`, `complained`, `failed`, `delivery_unknown`) and their sinks:
  `createMemoryAuditSink`, `createLoggerAuditSink`, `combineAuditSinks` (with `has` and
  `appendMany` where a sink of them has them), `stateOf`, `isFinalState`, and
  `auditEventOfDeliveryEvent` and `stateOfDeliveryEvent` for the events of `./webhooks`.
- **`./otel`**: `instrumentHandler(handler, { tracerProvider, meterProvider, withSpan })`, a span
  `mailer.queue.process` per run of a job, linked to the producer's trace (the `traceparent` the
  mail queue's `traceContext` gives each job as `trace`), and the metrics `mailer.queue.jobs` (by
  outcome and code), `mailer.queue.lag`, `mailer.queue.job.duration` and
  `mailer.queue.redeliveries`.
- **`./render`**: `RenderOutput.subject` and `renderFields(renderer, input)`, which gives
  `{ subject, content }`.
- **The root**: the contracts of the reliability layer as types (`QueueDriver`, `QueueSource`,
  `QueueJob`, `QueueJobRequest`, `QueueLease`, `QueueOutcome`, `QueueHandler`, `QueueConsumer`,
  `QueueConsumeOptions`, `QueueEnqueueOptions`, `MessageState`, `AuditEvent`, `AuditSink`,
  `JsonValue`, `JsonObject`), with no code.

### Tooling

- **Opt-in suites on the real services:** `pnpm test:bullmq` on BullMQ and Valkey
  (`tests/bullmq/docker-compose.yml`) and `pnpm test:mongodb` on a MongoDB replica set
  (`tests/mongodb/docker-compose.yml`), outside the gates, as `test:mailpit` is;
  `pnpm test:stores` runs both and fails without their stores, a manual step of every release.
- **`bench/outbox.js`**: the throughput of the outbox on a replica set, by workers and lanes.
- **One table of the codes of the queue** in its guide, which `tests/unit/codes.test.js` keeps in
  step with the code.
- **devDependencies for the tests:** the nine template engines, juice and css-inline, BullMQ,
  ioredis and the MongoDB driver; `src/` requires none of them, as `tests/unit/dependencies.test.js`
  checks.
- **Shared internals:** the backoff, the classification of thrown errors, the fingerprint of a
  message and the path check moved to `src/internal/`, with no change of behavior.

## [1.1.0] - 2026-10-18

The features of three libraries of the [comparison](https://mailerat.vercel.app/guide/comparison)
where they led this package, ported onto its contracts:
[nodemailer](https://github.com/nodemailer/nodemailer) 10.0.16 (MIT-0, © 2011-2023 Andris
Reinman), [unemail](https://github.com/productdevbook/unemail) 0.7.0 (MIT, © 2025 Wind) and
[sently](https://github.com/omqkhafi/sently) 1.2.2 (MIT, © 2026 sendx contributors). What is
ported is the feature, the mapping of a provider's fields, an algorithm or a test case; the HTTP
layer, the retries and the receipts are this package's. The known bugs of the sources are fixed in
the port, each with a test that fails on the source's behavior, and listed in `CLAUDE.md`. The
release adds sendmail, ten HTTP providers, attachments from paths and URLs, templates, verified
webhooks into one model of delivery events, five decorators, and Bun and Deno in CI. Everything is
additive but the defaults listed below.

### Upgrading from 1.0

- **EHLO names the machine:** the default is its host name when that is a fully qualified domain
  name, its address otherwise (`[127.0.0.1]` at worst), no longer `localhost`, which servers such
  as Postfix with `reject_non_fqdn_helo_hostname` refuse. Set `localName` to choose it.
- **A pooled SMTP connection carries at most 100 messages** (`maxMessages`), then is closed with
  `QUIT` and replaced; `Infinity` keeps the old behavior.
- **Bodies are encoded by their content:** 7bit for short ASCII lines, quoted-printable for mostly
  Latin text, base64 otherwise (Cyrillic, CJK), always with CRLF line breaks. Every body was
  quoted-printable.
- **Custom header fields are written capitalized** (`X-Custom-Header`, `List-Unsubscribe-Post`)
  rather than in lower case. Field names are case-insensitive, so readers and DKIM see no
  difference.
- **The default DKIM `h=` signs `List-Unsubscribe` and `List-Unsubscribe-Post`** too, as
  RFC 8058 asks.
- **Failures are classified more precisely:** a message a transport cannot send as it is (a
  provider's limit, a field it cannot express, `scheduledAt` where nothing schedules, a message
  over the SMTP server's `SIZE`) is a non-retryable failure of the new category `unsupported`,
  where it was `unknown`, `validation` or `rejected`, and `./pool` fails over with it to a
  transport that can send it; and a TLS certificate refused in the handshake is a non-retryable
  `configuration` failure at the first attempt, where SMTP reported it as `unknown` and the HTTP
  transports retried it and reported a retryable `network` failure (`deliveryUnknown` on Deno).
- **The HTTP providers of 1.0 share one client:** SES, Resend, SendGrid, Mailgun, Maileroo,
  Lettermint, Plunk and Mailtrap request through the client of the providers of 1.1. Their errors
  (`SendGridApiError`, `MailtrapTimeoutError`…) keep their names, arguments and fields, and carry
  `provider`, `category` and `retryable` besides; an error answer whose body cannot be read keeps
  its status; and a message Mailgun cannot express is an `unsupported` failure, as elsewhere.
- **`verify()` takes a 403 only where a key that may only send gets one:** SES, Mailgun and, of
  1.1, SparkPost, MailerSend and Scaleway. A 403 of SendGrid or Resend fails `verify()`, where it
  passed it.
- **A logger that throws is told once:** the first failure of the logger of a transport or
  decorator is a process warning (`MAILER_LOGGER_FAILED`) by the name and code of its error, not
  every record with its text, which could name a recipient.
- **On Deno, give the HTTP transports a `fetch` that keeps no idle connection**
  (`Deno.createHttpClient({ poolMaxIdlePerHost: 0 })`): Deno's own sends a request again when a
  reused connection closes before its answer. See
  [known issues](https://mailerat.vercel.app/guide/known-issues#deno).

### Added

- **Internationalized domains as A-labels:** `user@bücher.de` goes out as
  `user@xn--bcher-kva.de` in header fields, SMTP envelopes, JMAP and every provider, so it needs
  no SMTPUTF8; a local part beyond ASCII still does. The `Message` keeps the address as given.
- **`list` on the message:** the `List-Id` of RFC 2919, the URL fields of RFC 2369 (help,
  unsubscribe, subscribe, post, owner, archive), and with `oneClick` the `List-Unsubscribe-Post`
  of RFC 8058 that Gmail and Yahoo ask of bulk senders. Formatted as nodemailer does; a URL with
  whitespace, controls or angle brackets is refused, and one-click needs an `https` URL.
- **`scheduledAt`, `tracking` and `metadata` on the message,** from unemail's model: when the
  provider should deliver it, open and click tracking for this message, and values the provider
  returns in its events. A transport that cannot schedule refuses the message with an
  `unsupported` receipt rather than sending it at once, and `./pool` fails over with it. Resend,
  SendGrid, Mailgun, Maileroo, Brevo, MailerSend, SparkPost and SMTP2GO schedule; ten providers
  take `tracking`, seventeen `metadata` (each page says how).
- **`./attachments`:** `fromPath`, `fromUrl`, `fromDataUri`, `fromStream` and `inlineDataUrls`,
  for what nodemailer read through `path`, `href` and data URIs. Nothing is read implicitly:
  `fromUrl` goes through an injected `fetch`, checks each redirect with `allowUrl` (by default the
  host as written: no `localhost`, and no IP literal of a loopback, private, link-local,
  multicast, reserved or documentation range, NAT64 and 6to4 included, as written or as a name
  resolves), refuses a redirect from https to http, and bounds time and bytes; `fromPath` can be
  held to a `root` by real path and to `maxBytes`, and reads the file it checked;
  `inlineDataUrls` refuses HTML longer than `maxLength` before it reads it.
- **`./render`:** `renderContent(renderer, input)` for the content of `createMessage`,
  `createReactEmailRenderer({ render })` with the `render` of `@react-email/render` passed in, and
  `htmlToText`, linear in the length of its input.
- **`./smtp` connects through what you give it:** `connect` opens each connection (a proxy, a
  tunnel, a socket of another module) with implicit TLS or STARTTLS over it;
  `createHttpProxyConnector` makes one for an HTTP or HTTPS proxy, whose credentials go in clear
  to an `http://` proxy only on this machine or with `allowPlaintextCredentials`, under one
  deadline for the CONNECT; `localAddress` picks the address to connect from.
- **`./sendmail`:** the sendmail command of the system (Postfix, Exim, msmtp), one process per
  message, composed by `./mime` with DKIM; `sendRaw` and `verify`. Only an exit with 0 after the
  whole message succeeds, a signal after it is `deliveryUnknown`, and the sysexits codes are
  classified; a process has a `timeout` (60 seconds, then SIGTERM and SIGKILL) and at most
  `maxConcurrent` (10) run at once.
- **Raw messages and `verify()` through every decorator:** `./pool`, `./retry`, `./otel`,
  `./logger` and `./mock` pass `sendRaw` and `verify` on. `./ses` and `./mailgun` send raw MIME,
  and `./ses`, `./sendgrid`, `./resend` and `./mailgun` verify their key, one that may only send
  included.
- **Ten HTTP providers:** `./postmark` (with `/email/batch`), `./brevo` (an idempotency key on
  every request), `./mailjet` (the Send API v3.1 batch), `./mailersend`, `./sparkpost` (US or EU,
  raw MIME), `./zeptomail`, `./smtp2go` (US, EU or AU), `./azure` (Azure Communication Services,
  signed with the access key, repeatable requests), `./scaleway` and `./cloudflare` (the REST API
  of Cloudflare Email Service, raw MIME). Each goes through the request layer of the others: no
  redirect followed, a bounded body, `deliveryUnknown` when the provider may have taken the
  message. The batches of Postmark and Mailjet are cut by their bytes as well as their count.
- **`./breaker`:** a circuit breaker that opens after `failureThreshold` failures of the
  provider, answers with a retryable `service-unavailable` receipt while open (which `./pool`
  fails over with), and lets exactly one probe through after `resetTimeoutMs`, for at most
  `probeTimeoutMs`.
- **`./ratelimit`:** a token bucket per `key`, waiting first in, first out, or refusing with a
  retryable `rate-limit` receipt; an aborted send leaves the queue, and a cost over `burst` is
  refused. At most `maxKeys` buckets are kept in the process, the full ones dropped first, or a
  `store` of buckets that processes share holds them (`take(key, cost, limits)`); at most
  `maxQueue` messages wait in a bucket.
- **`./idempotency`:** a key reserved in a store before the send, so a repeat is answered with
  the first receipt, a send in flight as of unknown delivery, and the same key for another
  message refused. A reservation lasts `leaseMs` (10 minutes), so a key a crash left reserved is
  free again, and its token fences it: only its owner completes or releases it; the receipt is
  kept `ttlMs` (a day). `createMemoryIdempotencyStore` is the in-process store; a shared one
  implements `reserve`, `complete` and `release` with the token.
- **`./hooks`:** `beforeSend` may replace or refuse a message, `afterSend`, `onRetry` and
  `onError` hear each send, with a context made for each that carries its signal.
- **A `logger` for `./breaker`, `./ratelimit`, `./idempotency` and `./tee`,** pino-like, with a
  code for each event (`breaker.open`, `breaker.refused`, `ratelimit.waiting`,
  `ratelimit.waited`, `idempotency.in_flight`, `tee.mirror_failed`…).
- **`./tee`:** mirrors each message to other transports once the primary has answered it, with
  one Message-ID, each copy with a timeout of its own and not awaited by default (with
  `awaitMirrors`, awaited until that timeout at most, which keeps the process alive for it), the
  primary's receipt the one returned; disposal waits for the copies in flight.
- **Delivery events and `./webhooks`:** the `DeliveryEvent` model at the root, one event per
  message and recipient, and a verifier per provider for SES, Resend, SendGrid, Mailgun,
  Postmark, MailerSend, Mailtrap, Brevo, Mailjet, SparkPost, Lettermint, Maileroo, SMTP2GO, Azure
  and Scaleway. Nothing is read before it is verified: a signature where the provider signs (SNS
  with a topic allowlist, Svix, ECDSA, HMAC), its Basic credentials or token where it does not,
  within a window of time and once by its id. `verify()` reserves the id for `leaseMs` and gives
  the events with `commit()` and `release()`: an id is kept as taken once the application has
  handled its events, so a delivery whose handler failed is taken again, and another delivery of
  it meanwhile is refused as `pending`. `replayStore` is required where a verifier keeps ids
  (`createMemoryReplayStore()` in one process, a shared store of `reserve`, `commit` and
  `release` under the token of each delivery, or `null`), and a refusal carries the `status` to
  answer the provider with.
  `onVerify` hears each request taken or refused, and an event carries the `correlationId` of the
  message's metadata, given back by every provider but Azure, to find the events of a message of
  unknown delivery, and the `rfcMessageId` the provider reports.
- **`./pool` `verifyAll()`:** how each transport did, `verified`, `failed` or `unverifiable`,
  where `verify()` passes when one does.
- **Failures stand out in the metrics:** `mailer.email.messages` of `./otel` takes the category
  and the code of a failure (`error.type`, `mailer.error.code`).
- **A failure of unknown delivery stands out:** `./otel` sets `mailer.delivery_unknown` on its
  span and its message counter, and `./logger` writes `deliveryUnknown` in `email.failed`, for
  the messages to reconcile.
- **Bun and Deno:** CI runs the unit suite and the new `tests/runtime` (the package by its name,
  with no mock: sockets, TLS, DKIM, `fetch`, a child process) on Bun 1.4.3 and Deno 2.9.6, as
  well as on Node 22 and 24. `package.json` declares `"type": "commonjs"`, which Deno needs and
  Node assumes.
- **Documentation** for every new subpath, a guide to webhooks and events, Bun and Deno in
  getting started, and the comparison updated.

### Security

- **An attachment reads no file or URL it was not given by the application** (nodemailer read
  any `path` or `href`, following redirects to any address, cloud metadata included), and a data
  URI that does not parse is refused rather than read as a path.
- **A List-Unsubscribe URL or a metadata entry cannot add a header field:** a line break,
  whitespace or angle bracket in a URL is refused, and a metadata key is held to
  `[A-Za-z0-9_.-]`, its value to a string without control characters, with at most 64 keys and
  1024 characters to a value.
- **A DKIM signing domain or selector with a tab, CR or LF is refused** before it reaches the
  host parser, which removed them and let the name, line break and all, into the
  `DKIM-Signature` field (the fix of 1.0 missed it).
- **The webhooks of a provider are verified before they are read,** where sently parsed SES,
  SendGrid, Postmark and Brevo events unverified and checked Resend and Mailgun with no window
  of time or replay check. Basic credentials and tokens are compared by an HMAC of each, so the
  time of a refusal tells nothing of their length; a replay store is given the provider and a
  SHA-256 of each id, never an id that names a recipient; and a verifier whose provider signs no
  time refuses `toleranceMs` and `now` rather than ignore them.

### Fixed

- **A TLS certificate refused in the handshake was misclassified everywhere:** `unknown` in an
  SMTP receipt, a retried and retryable `network` failure on the HTTP transports (their receipts
  read the words `fetch failed`), and `deliveryUnknown` on Deno, whose `fetch` gives it no code;
  `classifyReceiptError` also missed `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, what Node and Bun report
  for an untrusted CA. It is now a non-retryable `configuration` failure at the first attempt, on
  every transport and runtime.
- **A message refused by a provider's limits before any request was `unknown`;** it is a
  non-retryable `unsupported` failure, which `./pool` fails over with, as a message no transport
  could send (`validation`, `rejected`) stops it.
- **A pooled SMTP connection was reused for any number of messages,** while servers limit the
  messages of one connection (`maxMessages`, above).
- **A timeout over 2^31 - 1 ms fired at once:** `timeout: 3e9` timed out every request of an
  HTTP provider, and an SMTP socket at once; such a timeout is now the longest a timer keeps, in
  effect none.
- **`verify()` of `./jmap` told `onRetry` of none of the reads it retried;** it tells it of each.

## [1.0.0] - 2026-10-17

The first release: the transport layer, ported from [upyo](https://github.com/dahlia/upyo) 0.7.0
(MIT, © 2025 Hong Minhee). The code is upstream's, converted to CommonJS with hand-written types
and no runtime dependency, one subpath per upstream package. Upstream's known bugs are fixed one
by one: the open ones are on the [Known issues](https://mailerat.vercel.app/guide/known-issues)
page, the fixed ones below. The reliability layer (a persistent queue, an audit log, delivery
events) is being designed and is not in this release.

### Upgrading from upyo 0.7

The messages, the `Transport` contract and the options of each transport are upyo's. What changes
for code written against upyo 0.7:

- **One package, a subpath per upstream package.** `@upyo/core` is the root entry,
  `@upyo/smtp` is `@alexify/mailer/smtp`, and so on for every transport and decorator;
  `@upyo/opentelemetry` is `./otel` and `@upyo/logtape` is `./logger`. The package is CommonJS,
  with the same names importable from ESM, and needs Node.js 22 or newer; Deno, Bun and browsers
  are not targets.
- **A failed receipt may carry `deliveryUnknown: true`:** the provider may have taken the message
  before the failure. Such a receipt is never retryable; reconcile it rather than send the message
  again.
- **`./otel` uses the providers you pass** (`tracerProvider`, `meterProvider`) and names its
  metrics and attributes after the semantic conventions (see Changed). `auto`, `serviceName`,
  `serviceVersion` and `metrics.samplingRate` throw a `TypeError`.
- **`./logger` takes any pino-like logger** in place of a LogTape one.
- **Options that never did anything throw:** `continueOnSuccess: true` of `./pool`,
  `validateSsl: false` of the HTTP providers and `method: 'cram-md5'` of `./smtp`.
- **Input is checked where it is made:** an address domain is held to host-name characters, a
  display name may not hold a line break, a provider URL must be HTTPS (plain HTTP only to a
  loopback host), an SES region must look like one, and `timeout` and `retries` must be
  non-negative numbers.

### Added

- **Messages and the transport contract** at the root entry: `createMessage` and the `Message`,
  `Address` and `Attachment` model, iCalendar parts, Message-ID and threading helpers, the
  `Transport`, `RawTransport` and `VerifiableTransport` contract, `Receipt` with classified
  errors, and raw-message plans.
- **`./mime`:** `composeMessage`, replayable MIME bytes with a separate envelope, DKIM signing
  with RSA-SHA256 or Ed25519, buffered or streaming. SHA-256 comes from `node:crypto` instead of
  `@noble/hashes`.
- **`./smtp`:** `SmtpTransport` on `node:net` and `node:tls`: pooling, STARTTLS, AUTH PLAIN,
  LOGIN, XOAUTH2 and OAUTHBEARER, PIPELINING, SIZE, DSN, SMTPUTF8, DKIM, `sendRaw` and
  `verify`.
- **HTTP providers** on `fetch`: `./ses` (SES v2 with SigV4), `./resend`, `./sendgrid`,
  `./mailgun`, `./mailtrap`, `./maileroo`, `./lettermint` and `./plunk`; and `./jmap` for
  RFC 8620/8621 servers.
- **Decorators:** `./pool` (strategies and failover), `./retry` (backoff, jitter,
  `Retry-After`), `./otel` (spans and metrics, with the OpenTelemetry providers passed in, the
  attributes as `mailer.*`) and `./logger` (the lifecycle logged through any pino-like logger
  passed in, in place of upstream's LogTape transport); and `./mock` for tests.
- **`concurrency` for `sendMany` of `./sendgrid`, `./mailgun`, `./plunk` and `./maileroo`:** the
  providers that send one message per request send that many at once (1 by default, as
  before), reading a message only when a send can start and giving the receipts in the order of
  the messages.
- **`onRetry` in the options of a send:** the HTTP providers, `./jmap` (whose discovery requests
  are the ones it retries) and `./retry` call it before each retry with the attempt, the wait and
  the error, and the decorators pass it on, so one callback hears every level.
- **`generateId` for the identifiers the library makes:** an `IdGenerator` (`(kind) => string`,
  with `IdKind` one of `message-id`, `content-id`, `idempotency-key` and `receipt-id`) can
  replace `crypto.randomUUID()`, such as a cuid2, a ULID or a nanoid. `generateMessageId` and
  `createMessage` take it in their options; it gives the left half of a Message-ID or a
  Content-ID, and what it returns is checked (a `TypeError` otherwise). `composeMessage` and
  `SmtpTransport` take it too, and `SmtpTransport` a `fetch` for the token refresh of OAuth 2.0
  (`TransportDependencies` at the root types both).
- **`fetch` and `generateId` in every HTTP transport:** the eight providers and `./jmap` take a
  `fetch`, read at each request in place of the global one (an undici `Agent`, a proxy, mTLS),
  and a `generateId` for their idempotency keys (Resend, Lettermint, the Maileroo reference) and
  for the message IDs they make up when the provider gives none (SES, SendGrid, Plunk).
- **`generateId` and `random` in the decorators:** `./retry` and `./pool` take `generateId` for
  the Message-ID they pin before the first attempt, and `./logger` for the message ID of a
  log-only receipt; `random`, a function like `Math.random`, makes the choices of the pool
  strategies (their constructors take it too), the simulated failures and delays of `./mock`,
  and the span sampling of `./otel`.
- **A `logger` for what happens inside `./smtp`:** pino-like, given in the configuration like
  `fetch` and `generateId` (`TransportDependencies`), it hears connections, STARTTLS upgrades,
  authentication and pool reuse at `debug`, and the protocol at `trace` with credentials and
  addresses redacted. Mail sent in plain text to another host is a `warn` with the code
  `MAILER_SMTP_PLAINTEXT`, which goes to `console.warn` when there is no logger.
  The HTTP providers and `./jmap` take one too, which hears each retry of a request at `debug`.
  `./pool` takes one for its failovers (`debug`) and a selector that throws (`warn`; it was
  skipped in silence), and `./retry` for the retries it schedules.
- **`./logger` logs retries** as `email.retrying` events, at the new level `levels.retrying`
  (`warn` by default), with the attempt, the wait, the redacted error text and its status code.
  With a wrapped transport, the logger needs a method for that level.
- **Documentation** for every subpath, adapted from upyo's guides.
- **Package scaffold** set up like the other Alexis libraries: plain CommonJS with no build step,
  a hand-written `index.d.ts`, a closed `exports` map, Node.js 22 or newer, and zero runtime
  dependencies.
- **Tooling:** pnpm, oxlint and oxfmt, `node:test` suites with c8 coverage gates, tsd type tests,
  an export-parity check between the runtime and `index.d.ts`, a check that `src/` requires only
  Node builtins, bundle tests through esbuild, a bundle-size budget (`pnpm size`) and a
  zero-dependency benchmark harness (`pnpm bench`).
- **Tooling for subpaths:** export-parity, bundle, size and `check:dts` read the exports map;
  a module-graph test forbids require cycles; a size budget per subpath; opt-in suites against
  Mailpit (`pnpm test:mailpit`) and real providers (`pnpm test:e2e`).
- **CI** on GitHub Actions and a VitePress documentation site at
  [mailerat.vercel.app](https://mailerat.vercel.app/), with a comparison of 14 Node.js email
  libraries generated from `docs/comparison.json`, @alexify/mailer in its first column, tinted
  in the brand teal and pinned beside the features.

### Security

- **A MIME boundary can no longer be guessed** (an upstream bug): it was built from the clock and
  `Math.random()`, so content that knew it could close a part early and add one of its own. It
  now comes from `crypto.randomUUID()`.
- **A DKIM setting can no longer add a header field** (an upstream bug): the signing domain,
  the selector, the signed field names, the algorithm and the canonicalization went into the
  `DKIM-Signature` field as given, so a domain such as `example.com\r\nBcc: …` added a Bcc to
  every message, and a `;` ended a tag early. They must now be valid (domain names, field names
  without `:` or `;`, known algorithms and canonicalizations), or the SMTP transport refuses
  them when it is made and `composeMessage` throws a `TypeError`.
- **An address can no longer end the path of an SMTP command** (an upstream bug). A quote in the
  domain hid a second `@` from the scan of `isEmailAddress`, and `URL.canParse` accepted the rest
  as userinfo, so `user@example.com> NOTIFY=NEVER ORCPT=rfc822;a"@x.com` passed and became
  `RCPT TO:<user@example.com> NOTIFY=NEVER …>`. A domain is now held to host-name characters
  (letters, digits, `-`, `.` and non-ASCII), so a port, path, query, fragment, comma, space,
  underscore or an empty label is refused too; a domain literal is an IPv4 address or an IPv6
  one, with or without the `IPv6:` tag. `./smtp` checks every path again right before it writes
  `MAIL FROM` and `RCPT TO`.
- **A display name can no longer add a mailbox** (an upstream bug). The MIME builder and
  `formatAddress` wrote a printable name as it was, and `./ses`, `./mailgun` and `./resend`
  escaped `"` but not `\` (SES escaped nothing), so the name `Support <attacker@evil.com>, Real`
  put a second address into `Reply-To`. A name that is more than atoms is now written as a quoted
  string with `\` and `"` escaped, as is one that reads as an encoded word; `createMessage`
  refuses a name with a line break and the formatters one with a control character; and
  `parseAddress` reads a quoted name holding `<` or `,` back, so it inverts `formatAddress`.
- **`composeMessage` checks an attachment's content type and content ID again** (an upstream
  bug): only `createMessage` refused a line break in them, so a message built by hand, such as one
  read back from a queue, could inject part headers.
- **`./smtp` bounds what a server's replies can take** (an upstream bug): a reply line is at most
  8192 characters and a reply at most 1000 lines, where a server that never ended a line made the
  client rescan everything received on every chunk until the socket timeout.
- **A transport no longer prints its credentials** (an upstream bug): `util.inspect`,
  `console.log` and `JSON.stringify` of `./smtp`, `./ses`, `./jmap` or an HTTP provider showed its
  API key, password, tokens or DKIM key, also through `./retry` and `./pool`. They now show
  `[REDACTED]`, as do credential headers such as `Authorization`; `transport.config` keeps the
  values.
- **`./otel` and `./logger` keep addresses out of error text by default** (an upstream bug): the
  status and events of a span carried the raw error text whatever `recordSensitiveData` said, and
  the logger wrote it with the provider's raw response, so the recipient of an SMTP rejection
  reached telemetry and logs. Without `recordSensitiveData` (otel) or `recordMessage` (logger),
  every address in that text is now `[REDACTED]`, and the logger leaves `providerDetails` out.
  `./plunk` no longer puts the start of the recipient's address into a synthetic message ID.
- **`./otel` redacts the `error.message` attribute too** (an upstream bug): a thrown error whose
  message began like a transport failure (`Connection…`, `Timeout…`) was recorded as it was, so
  `Connection refused by mx for bob@example.com` named the recipient. Its addresses are now
  `[REDACTED]` unless `recordSensitiveData` is on.

### Fixed

- **`./pool` and `./retry` no longer send a message twice where they can avoid it** (upstream
  bugs). A failed receipt can now say `deliveryUnknown: true`, which makes it not retryable:
  `./retry` does not retry it unless `shouldRetry` says so, and `./pool` does not pass it to
  another transport. The pool's own timeout produces it (upstream failed over, so a slow
  provider and the next one could both deliver). The pool also stops failing over at an error of
  category `validation` or `rejected`, which every provider would share (upstream sent a
  refused message to each transport in turn). Both decorators give a message without a
  Message-ID one before the first attempt, so all attempts carry the same one.
- **`./smtp` marks a failure after the end of DATA as of unknown delivery** (an upstream bug): a
  connection that closed or timed out after the terminating dot was a retryable network or
  timeout failure, like one before it, so a retry could deliver the message twice. It is now
  `deliveryUnknown` with the code `smtp.delivery-unknown`.
- **`./jmap` no longer replays the request that submits an email** (an upstream bug): `send` and
  `sendMany` retried `Email/set` with `EmailSubmission/set` after a network failure, which could
  submit the message twice. That request is now sent once; a failure without an answer is
  `deliveryUnknown`, unless the connection was never made. `JmapApiError` takes a `cause`.
- **The HTTP providers no longer send a message again after a 2xx** (an upstream bug): `./ses`,
  `./resend`, `./sendgrid`, `./mailgun`, `./maileroo`, `./lettermint` and `./plunk` retried when
  the body of a successful response could not be read or parsed, or when SES or SendGrid answered
  a 2xx other than the one they expect, though the provider had taken the request. Such a failure
  is now `deliveryUnknown` (so is `./mailtrap`'s unreadable success); Plunk's `success: false` in a
  200 is a non-retryable failure.
- **`./resend` and `./plunk` stop at once when the caller aborts during the wait between retries**
  (known upstream bug 9): the abort took effect only after the backoff, up to ten seconds.
- **`./lettermint` rejects with the caller's abort reason** (an upstream bug): an abort during the
  wait between retries rejected with an `AbortError` of its own.
- **The timeout of an HTTP provider covers the body of the response** (an upstream bug): it ended
  when the headers arrived in `./ses`, `./resend`, `./sendgrid`, `./mailgun`, `./lettermint`,
  `./plunk` and `./jmap`, so a body that never ended held the send forever. A body cut short
  after a 2xx is of unknown delivery.
- **`timeout: 0` and `timeout: Infinity` mean no timeout in every HTTP provider** (an upstream
  bug): 0 aborted every request at once in `./ses`, `./resend`, `./sendgrid`, `./mailgun` and
  `./jmap` while it meant none in the others, and `Infinity` became 1 ms. A negative or
  non-numeric `timeout`, and `retries` that are not a non-negative whole number, are refused
  with a `RangeError` when the transport is made.
- **`parseRetryAfter` reads a delay longer than a day as a day** (an upstream bug): a value such as
  `99999999999` meant about 3,170 years.
- **Every HTTP provider waits for `Retry-After`, up to 30 seconds** (known upstream bug 9):
  `./ses`, `./resend`, `./sendgrid`, `./mailgun`, `./plunk`, `./lettermint` and `./jmap` parsed it
  and retried after their own backoff anyway, while `./mailtrap` and `./maileroo` waited for it
  however long it was. A longer one is no longer waited for within the send: the failure is
  returned at once with its `retryAfterMilliseconds`.
- **No request follows a redirect** (an upstream bug): `fetch` followed them and strips only
  `Authorization` on a cross-origin one, so Maileroo's `X-API-Key`, Mailtrap's `Api-Token`,
  Lettermint's token, custom `headers` and the body of the OAuth2 token request (client secret,
  refresh token) went wherever a redirect pointed. Every request of the HTTP providers, `./jmap`
  and the OAuth2 refresh of `./smtp` now gets a 3xx back as a failure, which is not retried.
- **A provider no longer sends its credentials over plain HTTP** (an upstream bug): a `baseUrl`,
  a Mailtrap base URL or a JMAP `sessionUrl` starting with `http://` sent the API key or token in
  clear. They must use HTTPS, or plain HTTP only to a loopback host such as a local fake server;
  anything else is refused with a `TypeError` when the transport is made.
- **A response body is read within 4 MiB** (an upstream bug): every HTTP provider, `./jmap` and
  the OAuth2 token request of `./smtp` read a response whole, however long, so a broken or
  hostile endpoint could fill the memory of the sender. A longer body is refused, by its
  `Content-Length` or as it streams; after a 2xx, that is an unknown delivery.
- **Provider errors keep their cause** (an upstream bug): once retries were spent, `SesApiError`,
  `ResendApiError`, `SendGridApiError`, `MailgunApiError` and `PlunkApiError` rewrapped the last
  failure without it, so `fetch failed` lost the refused connection or the certificate error
  behind it, and so did the errors for a body that was not JSON. They keep it as `cause`, and
  their constructors take an `options` argument with it.
- **`classifyReceiptError` classifies by structure before words** (an upstream bug): it looked
  for status codes anywhere in the message, so `Message size 4013 octets exceeds` was an
  authentication error, and it ignored the `statusCode` of an HTTP error and the system code
  behind `fetch failed`. It now classifies by `statusCode`, then by the code along the causes
  (a refused connection or a timeout retryable, a rejected TLS certificate a configuration
  error that is not), and only then by the words of the message, status codes as whole numbers.
- **`./ses` refuses a wrong `authentication` when the transport is made** (an upstream bug): an
  unknown type, a missing key or a session without its token failed only at the first send,
  after the retries and their backoff.
- **Credentials outside Latin-1 work** (known upstream bug 4): SMTP AUTH PLAIN and LOGIN and the
  Basic authentication of `./jmap` and `./mailgun` encoded them with `btoa`, which throws on a
  Cyrillic or accented character. They are encoded as UTF-8.
- **An HTTP provider no longer resends a request that may have arrived** (an upstream bug): a
  timeout, a lost connection or a gateway timeout (504) before any usable answer was retried,
  though the provider may have taken the request. Unless the failure shows that the connection
  was never made (a refused connection, an unknown host, a rejected certificate), it is now an
  unknown delivery, not retried, for `./ses`, `./sendgrid`, `./mailgun`, `./mailtrap`,
  `./maileroo` and `./plunk`. `./resend` and `./lettermint`, which send an idempotency key that
  the provider deduplicates, still retry, and report the last failure as of unknown delivery.
- **`./jmap` keeps each attachment's own file** (an upstream bug): uploaded files were looked up
  by content ID, which is empty for every attachment that is not inline, so a message with two
  such attachments sent the second file twice.
- **`./jmap` sends its credentials only to the origin of the Session** (an upstream bug): the
  URLs of the Session were used as given, so a Session naming another host received the bearer
  token or password, and it stayed cached for five minutes. They must be on the origin of
  `sessionUrl` (or `baseUrl`), or in the new `trustedOrigins` option; a 401 or a 404 makes the
  next send fetch the Session again.
- **`./jmap` respects the `maxObjectsInSet` of the server in `sendMany`** (an upstream bug): it
  sent every message in one request, which a server with a lower limit refuses whole. It sends
  batches of at most that many messages, and a batch that fails fails only its own messages.
- **`./jmap` on Node 24 tells an authentication rejection from a network failure** (an upstream
  bug): the import, the submission and every raw upload went as a stream, which Node 24's
  `fetch` answers with `fetch failed` instead of an early 401. Requests go as a buffer, and a raw
  message of a known size up to 4 MiB is uploaded from one; one of unknown size still streams.
- **`./jmap` respects the `maxSizeRequest` of the server** (an upstream bug): a batch goes in as
  many requests as the limit takes, and a message whose request alone is over it fails with
  `jmap.request_too_large` before anything is sent, where the server refused it whole.
- **A configured name can no longer redirect a request** (an upstream bug): the SES `region` went
  into the host name as given, so `foo@evil.example/` sent the signed request, with its session
  token, to `evil.example`; the Mailgun `domain`, the Mailtrap `inboxId` and the JMAP account ID
  of a blob upload went into the path unencoded. A region must look like one (`us-east-1`), and
  the others are encoded as a single path segment.
- **One rule tells a loopback host** (an upstream bug): the OAuth 2.0 token endpoint of `./smtp`
  could use plain `http:` only to `localhost`, `127.0.0.1` and `::1`, while SMTP AUTH without TLS
  allowed any loopback host. Both, and the HTTP providers, now take `localhost`, a name under
  `.localhost`, 127.0.0.0/8 and `::1`, also as an IPv4-mapped address.
- **`./smtp` sends the host name for SNI** (an upstream bug): neither implicit TLS nor STARTTLS
  passed `servername`, and Node sends no SNI without it, so a server that picks its certificate
  by name answered with its default one, which then failed verification. Both send the host,
  and nothing for an IP address.
- **`./smtp` waits for the TLS handshake of `secure: true`** (an upstream bug): the connection
  counted as made when TCP connected, so `connectionTimeout` did not cover the handshake, and a
  server that never completed it held the send until the socket timeout. It is made once the
  handshake completes.
- **A message that cannot be composed no longer costs `./smtp` its connection** (an upstream bug):
  the message was composed after connecting and authenticating, and an error in it discarded
  the connection, failing every later message of a `sendMany` with "Connection is no longer
  valid". It is now composed first and fails alone; `sendMany` connects for its first composed
  message, and an empty batch opens no connection.
- **`./smtp` resets a pooled connection when it is next used** (an upstream bug): RSET ran before
  `send` returned its receipt, a round trip added to every send that ignored the caller's
  signal, and a connection the server had closed while idle failed the next send. The reset
  now runs when the connection is taken again, under that call's signal, and a connection that
  fails it is closed and replaced by another.
- **An idle `./smtp` connection no longer keeps the process alive** (an upstream bug): a pooled
  socket held the event loop until its socket timeout, so a script that sent a message hung
  unless it called `closeAllConnections()`. Idle sockets are now unref'd.
- **DKIM signs repeated and over-signed fields as RFC 6376 says** (an upstream bug): the signer kept
  one instance of each field, the last, so a name listed twice in `headerFields` signed that
  instance twice, and over-signing such as `['from', 'from']` produced a signature that failed
  verification. Each name now signs the next instance from the bottom up (§5.4.2), and one with
  no instance left signs nothing, which keeps another from being added.
- **DKIM signs the fields a reader trusts by default** (an upstream bug): the default
  `headerFields` were From, To, Subject and Date, so a Reply-To could be added, or the Cc,
  Message-ID or Content-Type changed, without breaking the signature. The default now also
  covers Reply-To, Cc, Message-ID, In-Reply-To, References, MIME-Version and Content-Type, and
  over-signs From, Reply-To and Subject.
- **DKIM takes a PKCS#1 key** (known upstream bug 6): a `BEGIN RSA PRIVATE KEY` PEM was imported
  as PKCS#8 and failed. The PEM is now read by `node:crypto`, which takes PKCS#1 and PKCS#8.
- **DKIM imports a key once, and `./smtp` checks it when made** (an upstream bug): a PEM key was
  parsed and imported for every message, and a broken one failed only at the first send. It is
  now imported once per signature configuration, and `SmtpTransport` throws a `TypeError` for
  a PEM it cannot read, unless `onSigningFailure` is `send-unsigned`.
- **`./retry` no longer hides a bug of the transport it wraps** (an upstream bug): any thrown
  error was retried and then turned into a failed receipt, a `TypeError` of a programming
  mistake included. A built-in error that is no recognizable delivery failure now rejects the
  send at once; a network failure reported by `fetch` as a `TypeError` is still retried.
- **`./pool` disposes of every transport and reports what failed** (an upstream bug): disposal
  dropped the errors of the transports, stopped at one that threw at once, and disposed of a
  transport listed twice twice. Each transport is now disposed of once, all of them whatever
  fails, and the failures reject the disposal as an `AggregateError`.
- **A logger that throws no longer loses a receipt** (an upstream bug): when the logger of
  `./logger` threw after a successful send, the send rejected, and a caller could send the
  message again; one that threw before stopped the send. The failure of the logger is now
  emitted as a process warning with the code `MAILER_LOGGER_FAILED`, and the send and its
  receipt go on.
- **`./mock` honors an abort during its delay** (an upstream bug): the simulated delay ran to its
  end whatever the signal said, and an abort rejected with a new `AbortError`. An abort now ends
  the delay at once, and the send rejects with the reason of the signal.
- **`./pool` rejects an aborted send with the reason of the signal** (an upstream bug), not with
  a new `AbortError`, like the other transports.
- **A DKIM signature skipped under `send-unsigned` is told to the logger** (known upstream bug 12):
  it went to `console.warn` whatever the application logged with. It now goes to the `logger`
  of `composeMessage` or of the SMTP transport, as a `warn` with the code
  `MAILER_DKIM_UNSIGNED`, and to `console.warn` only when there is no logger.
- **`./plunk` fails a send whose attachment cannot be read** (known upstream bug 12): it left the
  attachment out with a `console.warn` and sent the message without it, reported as sent. The
  send now fails before any request, as on the other providers.
- **`./resend` draws its idempotency key from `crypto.randomUUID()`** (known upstream bug 11): it
  came from the clock and `Math.random()`, and two sends that shared a key by chance would get
  the first one's answer, the second never going out.
- **`./retry` no longer retries sooner than a server asks** (an upstream bug): a `Retry-After`
  longer than `maxDelayMilliseconds` was cut to it, so the retry most likely met the same rate
  limit. The failed receipt is returned at once, with its delay.
- **`./otel` metrics no longer undercount** (an upstream bug): each counter and histogram was
  sampled with `metrics.samplingRate` and recorded unscaled, so all of them came out low by the
  rate, and the count of active sends drifted. Metrics are now recorded for every operation and
  only spans are sampled (`tracing.samplingRate`); `metrics.samplingRate` throws a `TypeError`.
- **`./otel` counts active sends down after `sendMany`** (an upstream bug): the count went up for
  a batch and never down. It goes down however a send or a batch ends, also when the caller
  stops reading the receipts.
- **`./otel` counts each message once** (an upstream bug): the message counter took a batch
  twice, its size at the start and then its successes and failures, and every message with
  `priority: 'normal'`. It now takes each receipt once, with the priority of its message and its
  `status`.
- **`./otel` tells a failed batch from a partly failed one** (an upstream bug): a batch in which
  every message failed was counted with `status: 'partial_failure'`. It is now a `failure`.
- **`./otel` applies `metrics.durationBuckets`** (an upstream bug): the option was never read. The
  duration histogram passes it to the SDK as the advice `explicitBucketBoundaries`
  (OpenTelemetry API 1.7 or later), which a View of the application still overrides.
- **`./otel` refuses the options it cannot honor** (an upstream bug): `auto`, `serviceName` and
  `serviceVersion` were accepted and never read, since the providers are passed in and the
  exporters and resource attributes belong to the SDK that builds them. They now throw a
  `TypeError`; the types `AutoConfig` and `CreateOpenTelemetryTransportConfig` are removed and
  `createOpenTelemetryTransport` takes an `OpenTelemetryConfig`.
- **`./otel` classifies a thrown error like a failed receipt** (an upstream bug): the default
  classifier looked for words and status codes as substrings, so `Author unknown` was an `auth`
  error and `timeout after 5000ms` a `server-error`. It now gives the category of
  `classifyReceiptError`, which reads them as whole words (a timeout is `timeout`), and
  `aborted` for an `AbortError`, which upstream counted as `network`.
- **`./pool` refuses `continueOnSuccess`** (an upstream bug): the option was accepted and never
  read, and honored it would deliver a sent message again through the other transports. It is
  gone from the type, and `true` throws a `TypeError`.
- **`validateSsl: false` throws instead of being ignored** (an upstream bug, `./ses`, `./resend`,
  `./sendgrid`, `./mailgun`, `./mailtrap`, `./plunk`): `fetch` checks every certificate, so the
  option never did anything. `false` now throws a `TypeError` that suggests a `fetch` of your
  own with an undici dispatcher for a test server.
- **`./smtp` refuses an authentication method it does not have when it is made** (an upstream
  bug): `cram-md5` was in the type and failed at the first send. It is gone from the type, and an
  unknown `method` throws a `TypeError` from the constructor.
- **`./ses` sends custom and threading header fields** (an upstream bug): they were dropped, so a
  reply lost its place in the thread. They go in the `Headers` of the message, up to the 15 SES
  takes; the fields SES sets itself are left out.
- **`./mailgun` sends an inline part under its Content-ID** (an upstream bug): Mailgun makes the
  file name of an inline part its Content-ID, and the file name was sent, so a `cid:` in the
  HTML matched nothing.
- **Header lines with encoded words keep to 76 characters** (an upstream bug): the first encoded
  word shared its line with the field name (`Subject: =?UTF-8?B?…?=`, up to 84 characters), past
  what RFC 2047 allows. Such a field now folds at 76, and its first word is split to fit.
- **Inline images go in `multipart/related`** (an upstream bug): `./mime`, and so `./smtp`,
  put inline parts in the `multipart/mixed` of the files, so some clients showed an image the
  HTML refers to by `cid:` as an attachment. They now go with the body in a `multipart/related`
  (RFC 2387), first in a `multipart/mixed` when there are files too.
- **`./ses`, `./resend` and `./jmap` stream `sendMany`** (an upstream bug): each read its whole
  input into an array before the first message went out, so a long or endless iterable was held
  in memory, or never sent. SES now reads `batchSize` messages at a time, Resend 100 (the batch
  API is chosen per chunk, where it used to be all or nothing for the whole input) and JMAP a
  batch of `maxObjectsInSet`, after one discovery.
- **`./retry` holds back at most `maxConcurrent` receipts in `sendMany`** (an upstream bug):
  while a slow first message was out, each later one that finished made room for the next, so
  the whole input could be sent and its receipts held for the first. A freed slot is still
  refilled, but no more than `maxConcurrent` finished receipts wait for an earlier one, and a
  settled send wakes the loop instead of a `Promise.race` over all the sends in flight.
- **`./pool` keeps the round-robin rotation across batches** (an upstream bug): `sendMany` reset
  the strategy, so a batch of one message always went through the first transport, and two
  batches at once reset each other's rotation.
- **`./otel` streams `sendMany`** (an upstream bug): it read the whole input into an array before
  the first message went out, and kept every receipt to the end, so a long or endless batch
  held it all in memory. The messages now pass on as the wrapped transport reads them; the batch
  attributes and the custom attributes of the span are set when the batch ends, and the span of
  a failed batch keeps its first ten error messages with the count of all.
- **`./otel` records the retries of the transport it wraps** (an upstream bug): `recordRetry`
  was never called. Through the new `onRetry`, each retry of the wrapped transport or of a
  `./retry` inside it now adds a `retry` event and to `mailer.retry.count` on the span, and to
  a new counter of retries, and still reaches the caller's own `onRetry`.
- **`./smtp` reads every well-formed reply** (upstream bugs): a final line that is the code alone
  (`250`), which RFC 5321 allows, no longer leaves the client waiting for the socket timeout, at
  any step or after DATA; the greeting waits for a complete line; and a UTF-8 character split
  across two chunks of a reply stays whole.

### Changed

- **`./otel` names its instruments and attributes after the OpenTelemetry semantic
  conventions.** The metrics are `mailer.email.attempts`, `.messages`, `.retries`, `.duration`,
  `.message.size`, `.attachments` and `.active_sends` under `metrics.prefix`, with units such as
  `{attempt}`, `s` and `By` in the instrument rather than `_total`, `_seconds` and `_bytes` in
  the name; their attributes are `mailer.transport.name`, `mailer.operation.name`,
  `mailer.status`, `email.priority`, `email.content.type` and `error.type` instead of
  `transport`, `operation`, `status`, `priority`, `content_type` and `error_type`. An HTTP
  transport's spans get `network.protocol.name: 'http'` and `url.scheme` instead of the scheme
  as the protocol, and the `exception` event carries `exception.stacktrace`, its message
  redacted.
- **One retry policy for every HTTP provider.** A request timeout (408), a rate limit (429), a
  server error (5xx) and a failure without a response are retried, after an exponential backoff
  capped at ten seconds and spread over its upper half (jitter), or after `Retry-After`. `./ses`,
  `./resend`, `./sendgrid`, `./mailgun`, `./plunk` and `./jmap` used to retry no 4xx at all, and
  waited without jitter, the first three without a cap.

[unreleased]: https://github.com/Alexis-Technologies/mailer/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/Alexis-Technologies/mailer/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Alexis-Technologies/mailer/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Alexis-Technologies/mailer/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Alexis-Technologies/mailer/releases/tag/v1.0.0
