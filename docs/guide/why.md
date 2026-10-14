# Why @alexify/mailer?

::: warning Work in progress
The transport layer is here, ported from [upyo](https://github.com/dahlia/upyo) 0.7.0. The
reliability layer is being designed: the direction below is settled, its API is not.
:::

## Two parts

@alexify/mailer is an email library of its own, in the place of Nodemailer, emailjs or Upyo, made
of two parts:

1. **The transport,** here today, ported from [upyo](https://github.com/dahlia/upyo) 0.7.0: an
   SMTP client, a MIME builder and DKIM signing, Amazon SES v2 (signed with SigV4, without the AWS
   SDK) and seven more HTTP providers on `fetch`, JMAP, and decorators for failover, retries,
   telemetry and logs.
2. **A reliability layer on top of it,** being designed. A persistent queue and outbox, an
   append-only audit log, one model of delivery events, suppression, idempotency and failover
   between providers.

## The gap it fills

The [comparison](/guide/comparison) puts fourteen Node.js solutions side by side: SMTP clients,
unified libraries, edge SMTP, a MIME builder and the official SDKs of the providers. Every one of
them sends a message. **None of them has a persistent queue, a local audit log and one model of
delivery events** (unemail plans a queue), and only two of the fourteen have idempotency keys.
That work is left to every application: a job that dies between "submitted" and "accepted", a
retry after a timeout that sends the same password reset twice, a bounce that nobody records.

The breadth of providers is not where the gap is. Each provider added is one more webhook format
and one more API that drifts, so beyond the eight that came with the port, a new provider waits
for a user who needs it, and the effort goes into what happens to a message after `send()`.

## Design

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
- **Correct before broad.** The transport is checked against a public set of golden `.eml`
  messages, DKIM signatures verified by an independent verifier, and fuzzing of headers,
  `multipart/related`, dot-stuffing and internationalized addresses.
- **No dependencies.** The transports use `node:*` modules and `fetch`. The driver of a queue or a
  database (BullMQ on Valkey or Redis, MongoDB) is created by your application and passed in.

## The plan

1. **Contracts:** the message and its builder, the transport, the queue driver, the audit sink,
   and the model of states and events.
2. **Reliable sending:** the MIME builder, the SMTP client and DKIM, SES v2 and one more HTTP
   provider, an outbox in MongoDB and a BullMQ driver, idempotency, the classification of errors,
   the audit log and the correctness suite.
3. **A closed loop:** webhooks into the event model, a suppression gate, failover with health and a
   circuit breaker, OpenTelemetry.
4. **Multi-tenant:** credentials, domains and quotas per tenant, List-Unsubscribe one-click,
   scheduled sending, more providers.

Out of scope: SMS, push and WhatsApp, inbound mail, and the management APIs of the providers
(domains, templates, statistics), which their official SDKs already cover.
