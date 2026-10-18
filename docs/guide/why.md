# Why @alexify/mailer?

::: tip Status
Version 1.0 is the transport layer, ported from [upyo](https://github.com/dahlia/upyo) 0.7.0, and
1.1 adds what nodemailer, unemail and sently did better, delivery events and the decorators of a
closed loop. The queue and the audit log are being designed: the direction below is settled, their
API is not.
:::

## Two parts

@alexify/mailer is an email library of its own, in the place of Nodemailer, emailjs or Upyo, made
of two parts:

1. **The transport,** here today, ported from [upyo](https://github.com/dahlia/upyo) 0.7.0 and,
   in 1.1, from [nodemailer](https://github.com/nodemailer/nodemailer),
   [unemail](https://github.com/productdevbook/unemail) and
   [sently](https://github.com/omqkhafi/sently): an SMTP client, sendmail, a MIME builder and DKIM
   signing, Amazon SES v2 (signed with SigV4, without the AWS SDK) and seventeen more HTTP
   providers on `fetch`, JMAP, and decorators for failover, retries, telemetry and logs.
2. **A reliability layer on top of it,** in part here. One model of delivery events read from
   verified webhooks, idempotency keys, a circuit breaker and rate limits came in 1.1; a persistent
   queue and outbox, an append-only audit log and suppression are being designed.

## The gap it fills

The [comparison](/guide/comparison) puts fourteen Node.js solutions side by side: SMTP clients,
unified libraries, edge SMTP, a MIME builder and the official SDKs of the providers. Every one of
them sends a message. **None of them has a persistent queue, a local audit log and one model of
delivery events** (unemail plans a queue), and only two of the fourteen have idempotency keys.
That work is left to every application: a job that dies between "submitted" and "accepted", a
retry after a timeout that sends the same password reset twice, a bounce that nobody records.

The breadth of providers is not where the gap is. Each provider added is one more webhook format
and one more API that drifts, so beyond the eighteen of 1.1 (the eight that came with the port and
the ten most used of unemail and sently), a new provider waits for a user who needs it, and the
effort goes into what happens to a message after `send()`.

## Design

The transport is built; the rest of this list is the design of the reliability layer, which is
being built. A failure after which a provider may have taken the message is already marked
`deliveryUnknown`, and `./retry` and `./pool` do not send it again; `./idempotency` reserves the
key of a message before it is sent, and `./webhooks` reads what happened to it afterwards.

- **At least once, with deduplication.** Exactly-once delivery is not possible over SMTP or HTTP.
  A message carries an idempotency key, the outbox deduplicates by it, and a provider that has no
  idempotency key (SES) leads to a `delivery_unknown` state that is reconciled from delivery
  events, never to a blind retry.
- **Every state is recorded.** `queued → rendered → submitted → accepted → delivered | bounced |
  complained | failed | delivery_unknown`, with the attempt, the provider's message id and a hash
  of the payload. The recipient is stored so that it can be erased later (a keyed hash plus an
  encrypted block whose key can be destroyed), because an append-only log cannot be edited.
- **Errors are classified.** Permanent failures (SMTP 5xx, a rejected address) are not retried;
  temporary ones are, with jitter and `Retry-After`. A provider is switched only on an error that
  says the message was not taken.
- **Secure by default.** TLS certificates are verified, AUTH never goes over plain text, CRLF in
  any header is rejected, the body is dot-stuffed, and reading files or URLs for attachments is
  off unless asked for.
- **Correct before broad.** The tests read the composed messages back with an independent
  parser; the transport is to be checked against a public set of golden `.eml` messages, DKIM
  signatures verified by an independent verifier, and fuzzing of headers, `multipart/related`,
  dot-stuffing and internationalized addresses.
- **No dependencies.** The transports use `node:*` modules and `fetch`. The driver of a queue or a
  database (BullMQ on Valkey or Redis, MongoDB) is created by your application and passed in.

## The plan

1. **Contracts:** the message and its builder, the transport, the queue driver, the audit sink,
   and the model of states and events.
2. **Reliable sending:** the MIME builder, the SMTP client and DKIM, SES v2 and one more HTTP
   provider, an outbox in MongoDB and a BullMQ driver, idempotency, the classification of errors,
   the audit log and the correctness suite.
3. **A closed loop:** webhooks into the event model, a circuit breaker and rate limits (all three
   in 1.1), a suppression gate, failover with health, OpenTelemetry.
4. **Multi-tenant:** credentials, domains and quotas per tenant, scheduled sending as a delay in
   the queue (providers that schedule do so in 1.1), List-Unsubscribe one-click and more providers
   (both in 1.1).

Out of scope: SMS, push and WhatsApp, inbound mail, and the management APIs of the providers
(domains, templates, statistics), which their official SDKs already cover.
