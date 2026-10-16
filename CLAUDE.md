# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**mailer** (npm package `@alexify/mailer`) is an email library for Node.js, in the place of
Nodemailer, emailjs or Upyo, made of two parts:

1. **The transport,** ported from upyo 0.7.0 (see "Code ported from upyo"): the message model,
   its own SMTP client, MIME builder and DKIM signing, Amazon SES v2 and seven more HTTP providers
   on `fetch`, JMAP, and the pool, retry, mock, OpenTelemetry and logger decorators, one subpath
   each.
2. **A reliability layer on top of it,** which none of the fourteen libraries in
   `docs/comparison.json` has: a persistent queue and outbox, an append-only audit log, one model
   of delivery events, suppression, idempotency and failover between providers.

It has zero runtime dependencies and runs on Node.js ≥ 22 only (no browser entry).

**Status: the transport is ported, the reliability layer is being designed.** The root entry
exports the message model and the transport contract of upyo, each transport and decorator is a
subpath. The reliability layer (queue, audit log, delivery events) has no API yet; its direction
is in "Roadmap" below.

It is maintained by Alexis Technologies and set up like the sibling libraries
`@alexify/metaschema` and `@alexify/protoarray` (the scaffold follows protoarray's
"chore: set up the repository as an Alexis library" commit). `origin` is
`Alexis-Technologies/mailer`.

Package manager is **pnpm** (pinned in `packageManager`).

## Commands

```bash
pnpm test                          # node --test tests/unit/*.test.js
pnpm test:mailpit                  # opt-in: tests/mailpit against a local Mailpit (compose file there)
pnpm test:e2e                      # opt-in: tests/e2e against real providers, from env variables
node --test tests/unit/mailer.test.js   # a single file
node --test --test-name-pattern="Bundle" tests/unit/*.test.js   # filter by name
pnpm run test:coverage             # c8 over src/, gated at 98 lines/statements, 90 branches, 100 functions
pnpm run test:types                # tsd: tests/types/*.test-d.ts, one file per entry
pnpm run check:dts                 # tsc --noEmit --strict over the d.ts of every entry
pnpm run lint                      # oxlint src tests scripts bench
pnpm run format                    # oxfmt src tests scripts bench (format:check in CI)
pnpm size [--max-gzip <KB>]        # esbuild bundle sizes; CI gates the root at 8 KB min+gzip and each subpath
pnpm bench [filter] [--json] [--save] [--compare]   # ops/sec harness, manual only; --save writes bench/baseline.json
pnpm docs:comparison               # renders docs/comparison.json into docs/guide/comparison.md
pnpm run docs:dev                  # VitePress dev server for docs/ (docs:build, docs:preview)
```

`prepublishOnly` runs lint + format:check + test:coverage + test:types + check:dts. CI adds the
size gate, the comparison drift check and the docs build. Treat that as the pre-merge gate. There
is no build step.

## No build step: CommonJS + hand-written types

- `src/` is plain CommonJS (`require`/`module.exports`) and ships as is. No TypeScript syntax, no
  `import`/`export`, no `'use strict'`.
- The root `index.js` is a one-line shim over `src/index.js`.
- `src/index.js` lists every export **by name** (`module.exports = { createMessage, … }`), never
  by spreading module objects. cjs-module-lexer only sees named keys, and ESM
  `import { createMessage } from '@alexify/mailer'` depends on it.
- `index.d.ts` is the only source of the public types, written by hand. A public API change touches
  `src/index.js`, `index.d.ts` and a test together. `tests/unit/export-parity.test.js` compares
  runtime exports with the declared value exports and imports every name from ESM.
  `tests/types/index.test-d.ts` (tsd) pins signatures. `check:dts` needs `--target es2022` because
  there is no tsconfig.
- `package.json` has a closed `exports` map (`types` first, then `default`), `sideEffects: false`
  and a `files` allowlist: `index.js`, `index.d.ts`, `src`, README, CHANGELOG, LICENSE and
  SECURITY.
- **Subpaths, not a monorepo.** A subpath is a directory `src/<subpath>/` with an `index.js` that
  lists its exports by name, an `index.d.ts`, and an entry
  `"./<subpath>": { "types": "./src/<subpath>/index.d.ts", "default": "./src/<subpath>/index.js" }`
  in the exports map. The export-parity, bundle and graph tests, `scripts/size.js` and
  `check:dts` (`scripts/check-dts.js`) read the exports map, so a subpath is checked as soon as
  it is declared. A subpath's d.ts imports the shared types from `'../../index.js'`.
  `tests/unit/graph.test.js` keeps `src/` free of require cycles and lets a subpath require
  another one only along the edges it lists.

## Zero dependencies: drivers are passed in

There is no `dependencies` or `peerDependencies` key in `package.json`, and there won't be one.

- **The transports are built on `node:*` and `fetch`:** SMTP on `node:net`/`node:tls`, DKIM and
  the SES SigV4 signature on `node:crypto`, HTTP providers on the global `fetch`. No provider SDK.
- **Infrastructure drivers are injected.** An adapter for a queue or a store takes the client or
  module the application created (a BullMQ `Queue`, a `MongoClient` or `require('mongodb')`), the
  way `./mongodb` of `@alexify/metaschema` takes the driver module. The package never `require`s
  them; they are devDependencies only, for tests.
- `tests/unit/dependencies.test.js` fails if `package.json` gains a dependency key or anything
  under `src/` requires a module that is neither a `node:` builtin nor a relative `.js` file.
- If a small helper is needed, copy it into `src/` with an attribution header rather than adding a
  dependency.

## Code ported from upyo

Most of the transport layer is a port of [upyo](https://github.com/dahlia/upyo) 0.7.0 (MIT,
Copyright 2025 Hong Minhee; the notice is in `LICENSE`): one subpath per upyo package, with
`@upyo/core` at the root, `@upyo/opentelemetry` as `./otel`, and `@upyo/logtape` replaced by
`./logger`, which takes any pino-like logger.

- Every ported file, source or test, starts with the attribution header:
  ```js
  // Ported from upyo v0.7.0 (packages/smtp/src/smtp-connection.ts)
  // https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee
  ```
- **The port keeps upstream's behavior.** What changes is the platform: CommonJS and the code
  style below, `node:crypto` instead of `@noble/hashes`, the OpenTelemetry providers and the
  logger passed in, fallbacks for runtimes older than Node 22 dropped, and the `@since` tags of
  upyo versions removed. A known upstream bug is fixed afterwards in its own `fix:` commit with a
  test that fails without it, not during the port.
- A lint rule that upstream code breaks is suppressed on the line,
  `// oxlint-disable-next-line <rule> -- upstream`, rather than rewritten; lifting those is a later
  refactor, like TS `private` fields, which stay plain properties (the tests reach into them).
  Style-only rules (`curly`, `object-shorthand`) are fixed instead, and a property access split
  over lines in a test goes through a variable (`no-unexpected-multiline`).
- **Coverage keeps the gates of the package.** Paths that upstream reached only end to end get flat
  suites against fakes (`tests/unit/<subpath>.test.js`); `/* c8 ignore */` marks only code that is
  dead upstream (`convertMessagesToBulk`, `recordRetry`) or unreachable on Node, each with its
  reason. Upstream tests of a runtime without `AbortSignal.any` are left out with a comment.
- Ported test suites keep upstream's `describe`/`it`, so they can be compared with upyo's; new
  suites use the flat style of "Testing notes". Tests for paths that upstream's suites leave out go
  into a new flat suite (`tests/unit/core.test.js` for `src/core/`).

**Known upstream bugs, each to fix in its own `fix:` commit after the port:**

1. mime: inline images (`contentId`) go into `multipart/mixed`, not `multipart/related`.
2. mailgun: an inline attachment is sent under its `filename`, not its `contentId`
   (`message-converter.js`), so a `cid:` in the HTML does not match it.
3. `validateSsl` is accepted and never read (ses, resend, sendgrid, mailgun, mailtrap, plunk).
4. (fixed, see 38) SMTP AUTH PLAIN and LOGIN encoded with `btoa`, which fails on non-Latin-1
   credentials; so did Basic auth in jmap and mailgun.
5. `cram-md5` is in the `SmtpAuth` type but not implemented.
6. DKIM: a PKCS#1 PEM (`BEGIN RSA PRIVATE KEY`) is imported as PKCS#8 and fails.
7. pool: `continueOnSuccess` is never read.
8. otel (partly fixed, see 44, 45 and 48): `auto` is ignored; `recordRetry` is never called; `sendMany` buffers
   its whole input; `defaultErrorClassifier` matches `"auth"` as a substring.
9. (fixed, see 25 and 30) resend and plunk slept between retries without the `AbortSignal`;
   ses, resend, sendgrid, mailgun and plunk parsed `Retry-After` but did not wait for it.
10. ses: custom and threading headers are not sent; `convertMessagesToBulk` is dead code.
11. resend: the `Idempotency-Key` comes from `Math.random`.
12. `console.warn` in mime (DKIM `send-unsigned`) and plunk instead of `process.emitWarning` or
    an injected logger.
13. mime: the first encoded word of a header shares its line with the field name
    (`Subject: =?UTF-8?B?…?=`, 84 characters), past the 76 that RFC 2047 allows a line with
    encoded words.
14. jmap: on Node 24, `fetch` answers a 401 to a streamed request body (raw upload, import,
    submission) with `TypeError: fetch failed` ("expected non-null body source") instead of the
    response, so an authentication rejection becomes a retryable network error. Node 22 returns
    the 401. The tests of it are `todo` on Node 24 until the fix.

**Upstream bugs found and fixed after the port** (each in its own `fix:` commit, with a test that
fails without it; ported tests that pinned the old behavior say "Changed after the port"):

15. core: `isEmailAddress` toggled quotes over the whole address and checked the domain with
    `URL.canParse` alone, so a domain could carry `>`, spaces, a port or userinfo and inject
    ESMTP parameters into `RCPT TO`. The domain is held to host-name characters, a domain
    literal to an IP address, and `./smtp` re-checks each path (`checkSmtpPath`).
16. mime, core, ses, mailgun, resend: a printable display name was written as it was (SES), or
    with `"` but not `\` escaped (mailgun, resend), so `<`, `,` and `@` in it added a mailbox.
    `formatMailbox`, `formatQuotedMailbox` and `formatPhrase` in `src/core/address.js` quote it;
    `createMessage` refuses a line break in a name.
17. mime: the content type and content ID of an attachment went into part headers unchecked when
    the message was not built by `createMessage`; `composeMessage` runs `checkAttachment` again.
18. smtp: replies were re-split whole on every chunk with no bound on a line or on the lines of a
    reply; a bare final line (`250`) was taken for a continuation and hung until the timeout; the
    greeting resolved on an incomplete line; and `toString()` per chunk broke a split UTF-8
    character. `createReplyReader` in `smtp-connection.js` decodes with a `StringDecoder` and
    bounds both (8192 characters, 1000 lines).
19. every transport: credentials sit on plain properties (TS `private` is not private at run
    time), so `util.inspect`, `console.log` and `JSON.stringify` of a transport printed API keys,
    passwords, tokens and DKIM keys. `src/internal/redact.js` backs `toJSON()` and
    `[util.inspect.custom]` on the ten transports that hold them; `config` keeps its values.
20. otel, logger, plunk: span status and events carried raw error text whatever
    `recordSensitiveData` said, the logger wrote failures with `providerDetails`, and plunk's
    synthetic message ID held the recipient's local part. `src/internal/redact-addresses.js`
    (`redactAddresses`, linear time) scrubs the text unless `recordSensitiveData` (otel) or
    `recordMessage` (logger) is set.
21. pool, retry: the pool failed over on any failed receipt, sending a refused message
    (`validation`, `rejected`) to every transport, and on its own timeout, after which the slow
    transport and the next could both deliver; each attempt of either decorator composed a new
    Message-ID. A failed receipt may carry `deliveryUnknown: true` (never retryable); the pool
    stops failover at it and at a message rejection, retry does not retry it, and both pin one
    Message-ID per message (`pinMessageId`, `src/core/message-id.js`).
22. smtp: a connection that closed or timed out after the terminating dot of DATA failed with
    the same retryable error as one before it. `writeMessageData` wraps a failure after the dot
    in `SmtpDeliveryUnknownError`, which `createSmtpFailure` turns into `deliveryUnknown`.
23. jmap: `send` and `sendMany` retried the request that creates and submits emails, as only
    `sendRaw` avoided. It goes through `submissionClient` (no retries); an unanswered failure is
    `deliveryUnknown` unless `isUnsentRequestError` (`src/internal/unsent.js`) finds a connection
    that was never made in its causes, which `JmapApiError` now keeps.
24. ses, resend, sendgrid, mailgun, maileroo, lettermint, plunk: a failure after a 2xx (an
    unreadable or unparsable body, a 2xx other than the expected one, Plunk's `success: false`)
    was retried, re-sending a message the provider had taken. Each client notes the 2xx
    (`isAccepted`) and throws `markDeliveryUnknown` (`src/internal/delivery-unknown.js`) instead
    of retrying; the transports report `deliveryUnknown`. Telling an unsent request from a sent
    one on a timeout or a reset is 39.
25. resend, plunk (known bug 9): the wait between retries ignored the `AbortSignal`, so an abort
    took effect only after the backoff. They use the abortable `sleep` of `src/internal/http.js`.
26. lettermint: an abort during the wait between retries rejected with a new `AbortError`
    instead of the caller's reason. It uses the shared `sleep`, which keeps the reason.
27. ses, resend, sendgrid, mailgun, lettermint, plunk, jmap: the timeout was cleared once the
    headers arrived, so a body that never ended held a send forever. The deadline of
    `requestWithRetry` lasts until the response is read, as mailtrap and maileroo had it.
28. every HTTP provider and jmap: `timeout: 0` aborted at once in five clients and meant none in
    four, `Infinity` became 1 ms, and neither `timeout` nor `retries` was checked. 0 and
    `Infinity` now mean none everywhere, and `checkRequestOptions` refuses anything else that is
    not a non-negative number, or retries that are not a whole number, when the config is made.
29. core: `parseRetryAfter` had no upper bound (`99999999999` gave about 3,170 years); a delay
    longer than a day is read as a day.
30. every HTTP provider and jmap (known bug 9): `Retry-After` was parsed and ignored by seven
    clients, and waited for without a bound by mailtrap and maileroo. `requestWithRetry` waits
    at least `retryAfterMilliseconds` between attempts, and when it is over 30 seconds throws
    the failure with it instead, for the caller or a queue to schedule.
31. retry: a `Retry-After` longer than `maxDelayMilliseconds` was cut to it, so the retry came
    sooner than the server asked and most likely met the same 429. The receipt is returned at
    once instead.
32. every HTTP provider, jmap and the OAuth2 token request of smtp: `fetch` followed redirects,
    and undici strips only `Authorization` on a cross-origin one, so `X-API-Key`, `Api-Token`,
    `x-lettermint-token`, custom headers and the token request's body went wherever a redirect
    pointed. Every request is sent with `redirect: 'manual'` (or `'error'`), and a 3xx is a
    failure that is not retried.
33. every HTTP provider and jmap: no URL of a config had to be HTTPS, so `http://` sent the key
    in clear. `checkSecureUrl` (`src/internal/http.js`, with `src/internal/loopback.js`) refuses
    anything but HTTPS or plain HTTP to a loopback host when the config is made.
34. every HTTP provider, jmap and the OAuth2 token request: a response body was read whole,
    however long, before anything looked at it. `readText`/`readJson` (`src/internal/body.js`)
    read it from its stream and refuse one over 4 MiB, by its `Content-Length` or as it comes.
35. ses, resend, sendgrid, mailgun, plunk, mailtrap, maileroo, lettermint: errors rewrapped once
    retries were spent, or for a body that was not JSON, dropped their cause, so `fetch failed`
    lost the ECONNREFUSED or certificate error behind it. Each keeps it as `cause`; the provider
    errors take an `options` argument for it.
36. core: `classifyReceiptError` read status codes as substrings of the message ("4013 octets"
    was `auth`, "5000 ms" a server error) and ignored the `statusCode` and the system `code` of
    the error. It classifies by `statusCode`, then by the code along the causes (a rejected
    certificate is a non-retryable configuration error), then by words, numbers as whole words.
37. ses: an unsupported authentication type or missing keys surfaced at the first send, inside
    the retry loop, which retried it like an outage. `SesTransport` refuses them when made.
38. smtp, jmap, mailgun (known bug 4): credentials went through `btoa`, which throws on any
    character outside Latin-1, inside the retry loop for the HTTP ones. They are encoded as
    UTF-8 with `Buffer`.
39. every HTTP provider: a timeout, a reset or a 504 before any usable answer was retried, and
    the provider may already have taken the request. `requestWithRetry` treats such a failure as
    ambiguous: unless the causes show a connection that was never made (`isUnsentRequestError`),
    it is thrown as `deliveryUnknown` without a retry; a request with an idempotency key
    (`hasIdempotencyKey`: resend, lettermint) is retried and only its last failure is marked; a
    read (`isIdempotent`: jmap queries) is retried and never marked.
40. jmap: uploaded blobs were keyed by `contentId`, which repeats and is empty for every
    attachment that is not inline, so attachments overwrote each other's blob and every part
    pointed at the last one. They are keyed by the attachment object.
41. jmap: `apiUrl`, `uploadUrl` and `downloadUrl` of the Session were used as given, so a
    Session naming another host received the credentials, and it stayed cached for
    `sessionCacheTtl` whatever happened. They must be on the Session's origin (that of
    `baseUrl` when rewritten) or in the new `trustedOrigins`, checked before caching, and a
    401 or a 404 forgets the cached Session.
42. jmap: `sendMany` put every message into one Email/set and EmailSubmission/set, whatever
    the `maxObjectsInSet` of the Session, so a server with a limit refused the whole batch,
    and any failure failed every message. It sends batches of at most that many (`sendBatch`),
    each failing on its own; discovery still runs once. `maxSizeRequest` is not yet followed.
43. ses, mailgun, mailtrap, jmap: the SES `region` went into the host name unchecked
    (`foo@evil.example/` sent the signed request to `evil.example`), and the Mailgun `domain`,
    the Mailtrap `inboxId` and the JMAP `accountId` of a blob upload into the path unencoded.
    The region must look like one (`us-east-1`), and the others are encoded as one segment.
44. otel: every counter and histogram was sampled with `metrics.samplingRate` and recorded
    unscaled, so each undercounted by the rate, and the UpDownCounter of active sends drifted.
    Metrics are recorded for every operation, only spans are sampled, and
    `metrics.samplingRate` throws a `TypeError`.
45. otel: the count of active sends went up for a `sendMany` and never down. It goes down when
    a send or a batch ends, however it ends, a batch the caller stops reading included.
46. otel: the message counter took every message of a batch twice (its size at the start, then
    its successes and failures), and always with `priority: 'normal'`. It takes each receipt
    once, with the priority of its message and its status.
47. otel: a batch in which every message failed was counted as a `partial_failure`. It is a
    `failure`; `partial_failure` is left for a batch with both outcomes.
48. otel: `metrics.durationBuckets` was never read. The duration histogram passes it to the SDK
    as the advice `explicitBucketBoundaries`.

## Repository layout

```
index.js  index.d.ts   root entry shim + hand-written types
src/
  index.js          public barrel (explicit named exports)
  version.js        the package name and version (OpenTelemetry scope), kept equal to package.json
  <subpath>/        one directory per subpath: index.js + index.d.ts + its modules
  internal/         private modules shared by subpaths, not in the exports map (redact.js,
                    redact-addresses.js, unsent.js, delivery-unknown.js, http.js,
                    config.js, loopback.js, body.js)
tests/
  unit/*.test.js    node:test suites, one per area (<subpath>-<module>.test.js for a subpath)
  helpers/<sub>/    shared test code of a subpath (fake servers, fixtures builders)
  fixtures/<sub>/   static fixtures (certificates)
  types/*.test-d.ts tsd assertions, one file per entry
scripts/
  size.js           bundle-size report and budget gates, one per subpath (CI smoke)
  check-dts.js      tsc --strict over the d.ts of every entry of the exports map
  comparison.js     renders docs/comparison.json into docs/guide/comparison.md
bench/              zero-dependency ops/sec harness; baseline.json is a snapshot for --compare
docs/               VitePress site (mailerat.vercel.app), not published
  comparison.json   the feature matrix of 14 alternatives (the data of the comparison page)
.claude/skills/     metaskills v1.0.5 skills (js-conventions, npm-publish adapted)
```

## Architecture

The root entry is the contract every subpath shares, ported from `@upyo/core` (`src/core/`):

- **`Message`**, built by `createMessage()`, which parses and validates the addresses (CR and LF
  are rejected), the attachments, the Message-ID and the threading headers, the date and an
  iCalendar part. `Address`, `Attachment` (bytes, a `Promise`, a `Blob` or a factory of chunks)
  and `Priority` go with it.
- **`Transport<TProviderId>`**: `send(message, { signal }) → Receipt` and
  `sendMany(messages) → AsyncIterable<Receipt>`. `RawTransport` adds `sendRaw()` for a ready MIME
  message (`RawMessage`, checked by `createRawMessagePlan`), `VerifiableTransport` adds
  `verify()`.
- **`Receipt`**: `{ successful: true, messageId }` or
  `{ successful: false, errorMessages, errors, retryable }`. A `ReceiptError` carries a `category`
  (auth, rate-limit, network, timeout, validation, rejected, server-error, service-unavailable,
  configuration, unknown), `retryable`, `statusCode` and `retryAfterMilliseconds`;
  `classifyHttpStatus` and `classifyReceiptError` classify. A transport reports a failure in a
  receipt rather than by throwing.

The contracts of the reliability layer, still to be designed (Phase 0):

- **`QueueDriver`**: enqueue, reserve, ack, retry with a delay; drivers for an outbox in MongoDB,
  BullMQ and an in-memory one for tests.
- **`AuditSink`**: append-only records of state changes; sinks for MongoDB, stdout/OTel logs and a
  custom one.
- **The states and events of a message:** `queued → rendered → submitted → accepted → delivered |
  bounced | complained | failed | delivery_unknown`, with correlationId, tenantId, attempt, the
  provider's message id and a hash of the payload.

## Roadmap

From the comparison of 14 Node.js email libraries (`docs/comparison.json`, 2026-10-07). The market
is not short of providers or SMTP clients; it is empty in the reliability layer. P0 is required for
a first release, P1 for an advantage over the alternatives, P2 after the first release.

**Phase 0, contracts.** The message and its builder, `Transport`, `QueueDriver`, `AuditSink`, the
model of states and events. `tenantId` is in the context from the start.

**Phase 1, reliable sending (P0).**

- **The transport of its own** (done, ported from upyo 0.7.0; its known bugs are on the list of
  "Code ported from upyo"): the MIME builder; the SMTP client (pool, STARTTLS with `requireTls`, not RFC 8689 REQUIRETLS,
  AUTH PLAIN/LOGIN/XOAUTH2, DSN, PIPELINING); DKIM (RSA-SHA256, Ed25519); SES v2 over `fetch` with
  SigV4; seven more HTTP providers and JMAP.
- **A persistent queue:** the outbox in MongoDB (transactional outbox, no Redis needed) and a
  BullMQ driver (Valkey) for throughput and delays; priorities (auth codes before newsletters).
- **The audit log** of every state, with a keyed HMAC plus an encrypted block for the recipient
  (crypto-shredding), so the right to erasure does not fight an append-only log. 3–6 records per
  message; optional hash chain for tamper evidence.
- **Idempotency:** a deterministic key (tenant + purpose + recipient + window) deduplicated in the
  outbox. At least once with deduplication, never a promise of exactly once. A provider without an
  idempotency key (SES) leads to `delivery_unknown` and reconciliation from events, not to a blind
  retry.
- **Errors classified:** permanent (5xx, rejected address) are not retried; temporary ones are,
  with jitter and `Retry-After`, under an attempt limit.
- **The correctness suite:** golden `.eml` files, DKIM checked by an independent verifier in CI,
  fuzzing of header injection, `multipart/related`, dot-stuffing and IDN. The reference must be
  external: tests that only pin the library's own output prove nothing (sently's "RFC" tests pin a
  wrong result).

**Phase 2, a closed loop (P1).** Webhooks of the providers into the one event model, with the
signature mandatory and replay protection, starting with SES (SNS) and one HTTP provider; a
suppression list per tenant and stream, checked before a message is queued, with a bypass policy
for transactional mail (password reset, MFA); failover over a pool of providers with health, a
circuit breaker with a single probe in half-open, and no switch after an ambiguous "submitted"
without an idempotency key (`./pool` of the port has strategies and failover, not yet health or a
breaker); OpenTelemetry spans and metrics (time in queue, attempts, failure rate per provider,
outbox size; `./otel` of the port covers sends); token-bucket rate limits per provider and per
tenant (SES quotas).

**Phase 3, multi-tenant (P1–P2).** Provider credentials per tenant (bring your own SES), domains
and DKIM per tenant, quotas; List-Unsubscribe one-click (RFC 8058) and the split between
transactional and bulk mail; scheduled sending as a queue delay; a `Renderer` interface with an
optional React Email adapter (no template engine of its own); more providers.

**Decisions:**

- **The transport is ported from upyo, not a wrapper over Nodemailer.** The comparison advises
  against rewriting SMTP (Nodemailer has 15 years of edge cases). Upyo already has the transport
  this roadmap planned, on the same platform (zero dependencies, `node:net`, `fetch`), so it is
  ported file by file instead of written anew; its known bugs are fixed afterwards (see "Code
  ported from upyo"), and the correctness suite of Phase 1 still applies to it.
- **BullMQ is one driver, not the base:** it ties the queue to Redis/Valkey; the MongoDB outbox
  gives a queue with no new infrastructure.
- **Few new providers.** The eight HTTP providers of upyo come with the port. Each provider adds
  its webhooks and API drift to maintain, so another one waits for a user who needs it.

**What the competitors appear to get wrong, to not repeat** (findings from reading their code in
October 2026, not reproduced except for emailjs, which was run against fake SMTP servers): no
dot-stuffing (emailjs); STARTTLS that accepts any certificate, or
falls back to plain text and sends AUTH (emailjs, worker-mailer, unemail without `requireTLS`);
Bcc in the headers of the message (worker-mailer); relaxed body canonicalization of DKIM that drops
every empty line instead of the trailing ones (sently); retrying permanent SMTP 5xx (sently);
inline images in `multipart/mixed` instead of `multipart/related` (Upyo, unemail); options
accepted but never read (Upyo `validateSsl`); no CRLF sanitization and `os.EOL` instead of CRLF
(MIMEText). The Upyo ones came with the port and are on the list of "Code ported from upyo".

**Out of scope:** SMS, WhatsApp and push (a `Channel` interface may stay, implementations no);
inbound mail; the management APIs of the providers (domains, templates, statistics), which the
official SDKs cover.

**To check before designing:** whether per-tenant fairness (groups) is a paid BullMQ Pro feature;
whether Fly.io restricts outgoing SMTP (it would make HTTP-first a requirement).

## Platform

Node.js ≥ 22 only: `engines` is `>=22.0.0`, CI runs 22 and 24 on Linux and Windows. There is no
`browser.js` and no `browser` field: sending from a browser would expose the credentials, and
SMTP needs sockets. `src/` may use `node:*` modules freely. Edge runtimes are not a target for
now; if they become one, the transport over `fetch` and the core would move behind a separate
entry with no `node:*`, and a platform test would enforce it as in protoarray.

## Conventions (oxlint/oxfmt + review)

- Formatting: 2 spaces, single quotes, semicolons, trailing commas, **100 columns**, LF
  (`.oxfmtrc.json`, `.editorconfig`). Lint: `.oxlintrc.json` (shared with protoarray: the explicit
  rule list, plus the `correctness` and `suspicious` categories as errors and `no-console`
  everywhere but `scripts/` and `bench/`). Suppress a rule only for an intentional construct, with
  a targeted `// oxlint-disable-next-line <rule>`.
- Code style:
  - module-level functions are arrow functions assigned to `const`; classes and prototype objects
    use method shorthand; no `function` declarations;
  - `Object.create(null)` for dictionaries;
  - hot loops (MIME encoding, header folding) avoid destructuring and use index loops, not
    `forEach`;
  - prefer `const`; no `var`;
  - private class members with `#`.
- Built-ins with the `node:` prefix; relative requires always end in `.js`.
- Self-descriptive code; comments explain *why*, not what.
- Conventional Commits (`feat(scope):`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`, `refactor!:`).

## Skills

`.claude/skills/` holds the seven [metaskills](https://github.com/metarhia/metaskills) v1.0.5
skills: `js-conventions`, `js-data-structures`, `data-structures`, `metautil-data-structures`,
`js-gof`, `error-handling` and `npm-publish`.

- **`js-conventions` is adapted to this toolchain** (the same copy as protoarray): oxlint/oxfmt
  instead of ESLint/Prettier, pnpm, 100 columns, plus a Modules section (CommonJS, no
  `'use strict'`, `node:` prefix, `.js` in relative requires). Its naming, best-practice and
  optimization rules are upstream's.
- **`npm-publish` is adapted to the release process below:** pnpm commands, the `prepublishOnly`
  gates plus the CI ones (size, comparison drift, docs build), this CHANGELOG's format, docs and
  `pnpm pack` checks, and `pnpm run release`.
- **The other five are verbatim copies.**

Keep the two adapted skills in sync with this file when conventions or the release process
change. **This file wins** if they ever disagree.

## Testing notes

- Runner: Node's built-in `node:test` + `node:assert`. Suites use flat
  `test('Area: description', …)`; keep that style. The suites ported from upyo are the exception:
  they keep upstream's `describe`/`it` (see "Code ported from upyo").
- `pnpm test` passes the glob unquoted (`tests/unit/*.test.js`): the shell expands it on Linux and
  macOS, and Node ≥ 22 expands it itself where cmd.exe does not, so Windows runs every version.
- `tests/unit/bundle.test.js` builds every entry of the exports map with esbuild in memory
  (minified and not) and checks its exports through the result, so the shipped files keep working
  after a consumer's bundler (a serverless function, a single-file deploy).
- `tests/unit/dependencies.test.js` guards "Zero dependencies" above.
- `tests/unit/scripts.test.js` runs `scripts/size.js` with a budget it always meets and one it
  never can.
- New behavior needs a test that fails without the change. Network transports are tested
  against local fake servers (`tests/helpers/smtp/mock-smtp-server.js` on `node:net`, servers on
  `node:http`) or a stubbed `fetch` (`t.mock.method(globalThis, 'fetch', …)`), never against a
  real provider in `pnpm test`.
- **Opt-in suites**, outside the gates: `tests/mailpit/` (`pnpm test:mailpit`, serial, as the
  inbox is shared; `docker compose -f tests/mailpit/docker-compose.yml up -d` and
  `MAILPIT_SMTP_HOST`/`MAILPIT_API_URL`) and `tests/e2e/` (`pnpm test:e2e`, each suite skipped
  until its provider's variables are set; Stalwart for JMAP in `tests/e2e/jmap/`).
- **Platform-dependent tests:** the mock SMTP server tolerates a client's connection reset (macOS
  and Windows send an RST where Linux sends a FIN); the seven JMAP tests of a 401 to a streamed
  body are `todo` on Node 24 (known upstream bug 14). `tests/unit/export-parity.test.js` also
  checks that every d.ts using `AsyncDisposable` references `esnext.disposable` itself.

## Documentation site

VitePress in `docs/`, deployed to Vercel (`vercel.json`) at `mailerat.vercel.app`. It is not
published to npm, and lint/format do not cover it.

- Only `docs/index.md` has frontmatter; links between pages are absolute and extensionless.
- `ignoreDeadLinks` is off, so `pnpm docs:build` failing on a dead link is a feature.
- The nav version label is read from `package.json`.
- **The comparison page is generated.** `docs/guide/comparison.md` holds the prose; the table
  between `<!-- comparison:start -->` and `<!-- comparison:end -->` is rendered by
  `pnpm docs:comparison` from `docs/comparison.json` (`legend`, `groups[].rows[]`,
  `libraries[].cells[rowId] = { mark, text, note? }`). Edit the data, never the table; CI fails on
  a diff. The page takes the full width through `.VPDoc:has(.ml-matrix)` in `custom.css`. The
  findings in cells come from reading the code and, except for emailjs, were not reproduced; the
  page says so, and a bug claim should be reproduced before it is made stronger.
- The brand is a teal "envelope" mark (`#0D6B63`, `#4CC2B5` on dark; a placeholder until a final
  logo): `docs/public/logo-mark*.svg`, `favicon.svg` (follows `prefers-color-scheme`),
  `favicon.png` and `logo.png` (the 1200×630 og:image, rendered from SVG with `rsvg-convert`).
- **The guides of upyo are adapted, not generated:** `docs/messages/` (compose, attachments,
  calendar, MIME) and `docs/transports/` (one page per subpath, plus custom transports), with
  examples in CommonJS on `@alexify/mailer/<subpath>`. `/transports/logger` is new (pino-like
  logger) and `/transports/otel` passes the providers in. One sidebar (`guide` in
  `config.mts`) covers the guide, the messages and the transports.
- When behavior changes, update README and the matching docs page together. Keep example outputs in
  the docs true to the code.

## Release process

Manual, as in the sibling repositories. The `npm-publish` skill walks through it step by step:

1. Bump `version` in `package.json` and in `src/version.js` (`tests/unit/version.test.js` fails
   while they differ).
2. Turn `## [Unreleased]` in CHANGELOG.md into `## [X.Y.Z] - YYYY-MM-DD` and add its link
   reference.
3. Commit, then tag `vX.Y.Z`.
4. Run `pnpm run release` (`pnpm publish`, gated by `prepublishOnly`; `publishConfig.access` is
   public).
