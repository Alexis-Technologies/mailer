# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**mailer** (npm package `@alexify/mailer`) is an email library for Node.js, in the place of
Nodemailer, emailjs or Upyo, made of two parts:

1. **The transport,** ported from upyo 0.7.0 (see "Code ported from upyo"): the message model,
   its own SMTP client, MIME builder and DKIM signing, Amazon SES v2 and seven more HTTP providers
   on `fetch`, JMAP, and the pool, retry, mock, OpenTelemetry and logger decorators, one subpath
   each. 1.1 adds what nodemailer, unemail and sently did better (see "Code ported from
   nodemailer, unemail and sently"): sendmail, an injected `connect` and an HTTP CONNECT proxy for
   SMTP, ten more HTTP providers, attachments from paths and URLs, List-* fields with one-click,
   templates with React Email passed in, and the circuit breaker, rate limit, hooks and tee
   decorators.
2. **A reliability layer on top of it,** which none of the fourteen libraries in
   `docs/comparison.json` has: a persistent queue and outbox, an append-only audit log, one model
   of delivery events, suppression, idempotency and failover between providers. 1.1 has the model
   of delivery events with the verified webhooks of fifteen providers (`./webhooks`) and the
   idempotency decorator whose store interface the outbox is to implement (`./idempotency`).

It has zero runtime dependencies and runs on Node.js ≥ 22, and on Bun and Deno through their
Node compatibility (see "Platform"; no browser entry).

**Status: 1.1 is the transport and the first parts of the reliability layer.** The root entry
exports the message model and the transport contract of upyo, with the delivery events of 1.1;
each transport, decorator and helper is a subpath, and their API is under semver from 1.0.0. The
queue, the audit log and suppression have no API yet; their direction is in "Roadmap" below.

It is maintained by Alexis Technologies and set up like the sibling libraries
`@alexify/metaschema` and `@alexify/protoarray` (the scaffold follows protoarray's
"chore: set up the repository as an Alexis library" commit). `origin` is
`Alexis-Technologies/mailer`.

Package manager is **pnpm** (pinned in `packageManager`).

## Commands

```bash
pnpm test                          # node --test tests/unit/*.test.js
pnpm test:runtime                  # tests/runtime: the package by its name, no mock (sockets, TLS, fetch, spawn)
pnpm test:bun                      # tests/unit and tests/runtime on Bun (bun test --parallel)
pnpm test:deno                     # tests/unit and tests/runtime on Deno (deno test --parallel)
pnpm test:mailpit                  # opt-in: tests/mailpit against a local Mailpit (compose file there)
pnpm test:e2e                      # opt-in: tests/e2e against real providers, from env variables
node --test tests/unit/mailer.test.js   # a single file
node --test --test-name-pattern="Bundle" tests/unit/*.test.js   # filter by name
pnpm run test:coverage             # c8 over src/, gated at 98 lines/statements, 90 branches, 100 functions
pnpm run test:types                # tsd: tests/types/*.test-d.ts, one file per entry
pnpm run check:dts                 # tsc --noEmit --strict over the d.ts of every entry
pnpm run check:pack                # the files `pnpm publish` would pack: the exports map, nothing else
pnpm run lint                      # oxlint src tests scripts bench
pnpm run format                    # oxfmt src tests scripts bench (format:check in CI)
pnpm size [--check]                # esbuild bundle sizes; --check gates every entry by scripts/size-budgets.json
pnpm bench [filter] [--json] [--save] [--compare]   # ops/sec harness, manual only; --save writes bench/baseline.json
pnpm docs:comparison               # renders docs/comparison.json into docs/guide/comparison.md
pnpm run docs:dev                  # VitePress dev server for docs/ (docs:build, docs:preview)
```

`prepublishOnly` runs lint + format:check + test:coverage + test:runtime + test:types + check:dts +
the size gate + check:pack. CI adds the comparison drift check, the docs build, and the unit and
runtime suites on Bun and Deno. Treat that as the pre-merge gate. There is no build step.

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
- `package.json` has a closed `exports` map (`types` first, then `default`), `sideEffects: false`,
  `"type": "commonjs"` (Node's default, declared for Deno, which otherwise reads `.js` as ESM)
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
  A d.ts names the directory of its package (`// Types ported from upyo v0.7.0
  (packages/smtp/src)`), as its types come from several files, and lines that say how a file
  was adapted may come between the two. A file that is not a port starts with
  `// Not ported:` and what it is. `tests/unit/attribution.test.js` checks one or the other in
  every file the package ships.
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
  unreachable on Node, each with its reason; code that is dead upstream is removed. Upstream tests of a runtime without `AbortSignal.any` are left out with a comment.
- Ported test suites keep upstream's `describe`/`it`, so they can be compared with upyo's; new
  suites use the flat style of "Testing notes". Tests for paths that upstream's suites leave out go
  into a new flat suite (`tests/unit/core.test.js` for `src/core/`).

**Known upstream bugs, each to fix in its own `fix:` commit after the port:**

1. (fixed, see 77) mime: inline images (`contentId`) went into `multipart/mixed`, not
   `multipart/related`.
2. (fixed, see 79) mailgun: an inline attachment was sent under its `filename`, not its
   `contentId` (`message-converter.js`), so a `cid:` in the HTML did not match it.
3. (fixed, see 84) `validateSsl` was accepted and never read (ses, resend, sendgrid, mailgun,
   mailtrap, plunk).
4. (fixed, see 38) SMTP AUTH PLAIN and LOGIN encoded with `btoa`, which fails on non-Latin-1
   credentials; so did Basic auth in jmap and mailgun.
5. (fixed, see 83) `cram-md5` was in the `SmtpAuth` type but not implemented.
6. (fixed, see 63) DKIM: a PKCS#1 PEM (`BEGIN RSA PRIVATE KEY`) was imported as PKCS#8 and
   failed.
7. (fixed, see 85) pool: `continueOnSuccess` was never read.
8. (fixed, see 44, 45 and 48 to 52) otel: `_active_sends` was not decremented after `sendMany`
   and drifted under sampling; `durationBuckets` and `auto` were ignored; `recordRetry` was
   never called; `sendMany` buffered its whole input; `defaultErrorClassifier` matched `"auth"`
   as a substring.
9. (fixed, see 25 and 30) resend and plunk slept between retries without the `AbortSignal`;
   ses, resend, sendgrid, mailgun and plunk parsed `Retry-After` but did not wait for it.
10. (fixed, see 82) ses: custom and threading headers were not sent. (`convertMessagesToBulk`,
    which nothing called, is removed.)
11. (fixed, see 71) resend: the `Idempotency-Key` came from `Math.random`.
12. (fixed, see 72 and 73) `console.warn` in mime (DKIM `send-unsigned`) and plunk instead of
    an injected logger.
13. (fixed, see 78) mime: the first encoded word of a header shared its line with the field
    name (`Subject: =?UTF-8?B?…?=`, 84 characters), past the 76 that RFC 2047 allows a line
    with encoded words.
14. (mostly fixed, see 81) jmap: on Node 24, `fetch` answers a 401 to a streamed request body
    with `TypeError: fetch failed` ("expected non-null body source") instead of the response,
    so an authentication rejection becomes a retryable network error; Node 22 returns the 401.
    Still open for a raw message of unknown size, which has to stream; its test is `todo` on
    Node 24.

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
    each failing on its own; discovery still runs once. `maxSizeRequest` is 80.
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
49. otel: `auto`, `serviceName` and `serviceVersion` were accepted and never read: exporters and
    resource attributes belong to the SDK that builds the providers passed in. They throw a
    `TypeError`, and `AutoConfig` and `CreateOpenTelemetryTransportConfig` are gone.
50. otel: `defaultErrorClassifier` looked for words and status codes as substrings, before the
    network check (`"Author unknown"` was `auth`, `"timeout after 5000ms"` a server error), and
    disagreed with the categories of the receipts. It is `classifyReceiptError` of the root, plus
    `aborted` for an `AbortError`, which upstream counted as a network failure.
51. otel: `sendMany` read its whole input into an array before sending the first message, and
    kept every receipt to the end. It passes the messages on as the wrapped transport reads
    them, pairs each receipt with the oldest message still waiting for one, sets the batch
    attributes of its span at the end, and keeps the first ten error messages of a failed batch
    with the count of all.
52. otel: `recordRetry` was never called, since nothing told the decorator of a retry. The
    wrapped transport now reports its retries through `onRetry` of `TransportOptions`; the
    decorator records each on the span (`mailer.retry.count` and a `retry` event), counts it
    in `mailer.email.retries`, and passes it on to the caller's `onRetry`.
53. otel: the `error.message` attribute of a thrown error was recorded raw when the message
    began like a transport failure (`Connection…`), whatever addresses followed. It goes
    through `describeError`, the redaction of the span status and events.
54. smtp: the OAuth 2.0 token endpoint allowed `http:` only to `localhost`, `127.0.0.1` and
    `::1`, while SMTP AUTH without TLS took any loopback host. `internal/loopback.js` holds
    the one rule (`localhost`, `*.localhost`, 127.0.0.0/8 and `::1`, also IPv4-mapped, on
    `net.BlockList`) for SMTP, OAuth 2.0 and the HTTP providers, in place of SMTP's own IPv4
    and IPv6 parsers.
55. smtp: implicit TLS and STARTTLS sent no SNI, as Node sends none without `servername`, so
    a server with a certificate per name answered with its default one, and a user was pushed
    towards `rejectUnauthorized: false`. Both send the host (without a final dot, and nothing
    for an IP address).
56. smtp: implicit TLS resolved `connect()` on the TCP `connect`, before its handshake, so the
    connection timeout did not cover the handshake and a failed one surfaced later, while the
    greeting was read. It resolves on `secureConnect`.
57. smtp: `send` and `sendMany` composed a message only after connecting, upgrading and
    authenticating, and a composition error, not a reusable local failure, discarded the
    connection; in `sendMany` every later message then failed with "Connection is no longer
    valid". A message is composed first, a failure to compose takes and fails no connection,
    and `sendMany` connects for its first composed message (none for an empty batch).
58. smtp: a pooled connection was reset (RSET) before `send` returned its receipt, adding a
    round trip to every send, without the caller's signal, and a connection the server dropped
    while idle then failed the next send. RSET runs when the connection is next taken
    (`takePooledConnection`), under that caller's signal; one that fails it is closed and
    replaced.
59. smtp: an idle pooled socket kept the event loop alive until its socket timeout, so a
    script that sent a message did not exit without `closeAllConnections()`. A pooled socket
    is unref'd while idle and ref'd again when taken.
60. DKIM: the header fields were kept one per name, the last, so a name listed twice in `h=`
    signed that instance twice, against RFC 6376 §5.4.2, and over-signing (`h=from:from`) made
    a signature no verifier accepts. Each name in `h=` signs the next instance from the bottom
    up, and one with none left signs nothing.
61. DKIM: the default `h=` was From, To, Subject and Date, so Reply-To, Cc, Message-ID or the
    Content-Type could be changed or added without breaking the signature. It adds Reply-To,
    Cc, Message-ID, In-Reply-To, References, MIME-Version and Content-Type, and over-signs
    From, Reply-To and Subject.
62. DKIM: `signingDomain`, `selector`, the names in `headerFields`, the algorithm and the
    canonicalization went into the DKIM-Signature field unchecked, so a domain with a line
    break added a header field such as Bcc to the message, and a `;` ended a tag early.
    `checkDkimConfig` refuses them, from the SMTP constructor and at every composition. A name
    with a tab, CR or LF, which the WHATWG parser behind `domainToASCII` removes before it reads
    the name, is refused before it gets there; the first version of this fix let one through.
63. DKIM (known bug 6): a PEM was stripped of its armor and imported as PKCS#8, so a PKCS#1
    key (`BEGIN RSA PRIVATE KEY`) failed. `createPrivateKey` of node:crypto reads either and
    the key reaches Web Crypto as PKCS#8; the import error keeps its cause.
64. DKIM: a PEM key was parsed and imported for every message, and a broken one failed only at
    the first send. It is imported once per signature configuration (`resolvePrivateKey`, a
    WeakMap), and the SMTP transport reads it when it is made (`checkDkimKeys`), unless the
    configuration sends unsigned on a signing failure.
65. retry: every error the wrapped transport threw became a failed receipt, retried first, so a
    bug such as reading a property of `undefined` was retried and hidden. A `TypeError`,
    `RangeError`, `ReferenceError` or `SyntaxError` that `classifyReceiptError` does not
    recognize (category `unknown`) is rethrown at once; a fetch failure keeps being retried.
66. pool: dispose swallowed the errors of the transports (`catch {}`, `allSettled`), stopped at a
    transport whose async dispose threw before returning a promise, and disposed of a transport
    listed twice twice. Each is disposed of once (a WeakSet), all of them whatever fails, and
    the failures reject together as an `AggregateError`.
67. logger: a logger that threw after a successful send turned the send into a rejection, so
    the receipt was lost and a caller could send the message again; one that threw before
    stopped the send. `log()` catches it and emits a process warning
    (`MAILER_LOGGER_FAILED`); the send and its receipt go on.
68. mock: the simulated delay ignored the `AbortSignal`, and an abort rejected with a new
    `AbortError` instead of the reason of the signal. The delay is the abortable sleep of
    `internal/sleep.js`, and every abort rejects with the reason.
69. pool: a send or a batch aborted by the caller rejected with a new `AbortError` rather than
    the reason of the signal. It rejects with the reason.
70. mime: a boundary was `Date.now()` and six characters of `Math.random()` (with the
    deprecated `substr`), which two messages in one millisecond can share and an attacker can
    guess to end a part early with text of their own. It is `boundary-` and `crypto.randomUUID()`.
71. resend (known bug 11): a generated `Idempotency-Key` was the clock and two `Math.random()`
    strings, which two sends could share, and Resend answers a repeated key with its first
    answer, so one of them would not go. It is `crypto.randomUUID()`.

72. mime (known bug 12): a DKIM signature that failed under `send-unsigned` was told with
    `console.warn`, whatever the application logged with. It goes to the `logger` of
    `composeMessage` or of the SMTP transport (`warn`, code `MAILER_DKIM_UNSIGNED`), and to
    `console.warn` only without one (`warnDegradation` of `internal/log.js`).
73. plunk (known bug 12): an attachment that could not be read was left out with a
    `console.warn`, and the message went without it, reported as sent. It fails the send, as
    on the other providers, before any request.
74. ses, resend, jmap: `sendMany` read its whole input into an array before the first message
    went out, so a long or endless iterable was held in memory, or never sent. Each reads a
    batch at a time (`chunks` of `internal/batch.js`): SES `batchSize` messages, Resend 100,
    each chunk choosing between the batch API and single requests, and JMAP `maxObjectsInSet`
    after one discovery, made only when there is a first message.
75. retry: `sendMany` counted only the sends in flight against `maxConcurrent`, so while a
    slow first message was out, every later one that finished freed its slot for the next,
    and the whole input could be sent with its receipts held for the first; it also raced all
    the sends in flight on every turn. No more than `maxConcurrent` finished receipts wait for
    an earlier one (`SendManyRun`), and a send that settles wakes the loop instead of a race.
76. pool: `sendMany` reset the strategy, so round-robin sent every batch of one message
    through the first transport, and concurrent batches reset each other's rotation. The
    strategy goes on from where the sends before left it.
77. mime (known bug 1): inline parts went into the `multipart/mixed` of the files, so a client
    could show an image the HTML refers to by `cid:` as an attachment. They go with the body in
    a `multipart/related` whose `type` names the root part (RFC 2387), which sits first in a
    `multipart/mixed` when there are files too, as `./jmap` already built it.
78. mime (known bug 13): a line with an encoded word could reach 84 characters, as the first
    word shared its line with the field name and other lines folded at 78, past the 76 of
    RFC 2047 §2. A field with encoded words folds at 76, the first word is split at a whole
    character to fit after the field name (`fitFirstEncodedWord`), and a name too long for
    any text after it leaves the first line to itself.
79. mailgun (known bug 2): an inline part was sent under its file name, which Mailgun makes its
    Content-ID, so the `cid:` of the HTML matched nothing. It goes under its `contentId`.
80. jmap: the `maxSizeRequest` of the Session (RFC 8620 §2) was not followed, so a batch, or a
    message with a long body, over it was refused whole. A batch goes in as many requests as
    the limit takes (`groupBySize`, measured once per message), each failing on its own, and a
    message whose request alone is over it fails with `jmap.request_too_large`, unsent.
81. jmap (known bug 14, Node 24): the import, the submission and every raw upload went as a
    stream, which Node 24's fetch answers with a network failure instead of an early 401.
    Requests go as a buffer (upstream streamed them against a replay seen in Deno; Node's fetch
    does not replay a POST), and a raw message of a known size up to 4 MiB is read into one
    buffer after validation (`bufferRawUpload`). A raw message of unknown size still streams.
82. ses (known bug 10): custom header fields and the threading ones were not sent, so a reply
    lost its place in the thread. They go in the `Headers` of Simple content (SES v2, up to 15
    fields of 996 characters, the ones SES sets left out, values beyond ASCII as encoded words);
    more fail the send before any request.
83. smtp (known bug 5): `cram-md5` was a `method` of the type and failed at the first send, as
    did any method the connection did not know. It is gone from the type (an obsolete mechanism
    whose server keeps a password equivalent, where AUTH goes over TLS anyway), and
    `SmtpTransport` refuses an unknown method when it is made (`checkAuthMethod`).
84. ses, resend, sendgrid, mailgun, mailtrap, plunk (known bug 3): `validateSsl: false` was
    accepted and ignored, so a caller believed certificates went unchecked. Node's fetch has no
    switch for it without undici, so `false` throws a `TypeError` that points to a `fetch` of
    the caller's own (`checkValidateSsl`); true or absent changes nothing.
85. pool (known bug 7): `continueOnSuccess` was accepted and never read; honored, it would send
    a message that went out through one transport again through the others. It is gone from
    the type, and `continueOnSuccess: true` throws a `TypeError` when the pool is made.
86. smtp: a failure without a reply of the server was classified by the words of its message
    alone, so a certificate refused during the TLS handshake was `unknown`; and
    `classifyReceiptError` (36) took only the codes that name a certificate, which the leaf of an
    unknown issuer does not (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, what Node and Bun report for an
    untrusted CA). The receipt takes the classification of the error, by the code along its
    causes, and `isCertificateCode` (`src/core/receipt.js`) knows that code: a refused
    certificate is a `configuration` failure, not retried, on Node, Bun and Deno.
87. every HTTP provider and jmap: a TLS certificate refused in the handshake was retried, as
    `requestWithRetry` retries any failure without a status, and its receipt was classified by
    the words of its message (`fetch failed`), a retryable `network` failure; on Deno, whose
    `fetch` gives it no code, `isUnsentRequestError` found no sign of an unsent request and it was
    `deliveryUnknown`. `isCertificateFailure` (`src/core/receipt.js`) knows it by the code along
    the causes or by Deno's text (`invalid peer certificate`), for `classifyReceiptError` and
    `isUnsentRequestError`; `requestWithRetry` throws it at the first attempt; and
    `certificateFailure` (`internal/refusal.js`), first in the failure of every HTTP transport,
    makes its receipt a non-retryable `configuration` failure.

## Code ported from nodemailer, unemail and sently

From 1.1 the package also takes the features of three libraries of `docs/comparison.json` where
they lead it: [nodemailer](https://github.com/nodemailer/nodemailer) 10.0.16 (MIT-0, Copyright
2011-2023 Andris Reinman), [unemail](https://github.com/productdevbook/unemail) 0.7.0 (MIT,
Copyright 2025 Wind) and [sently](https://github.com/omqkhafi/sently) 1.2.2 (MIT, Copyright 2026
sendx contributors). Their notices are in `LICENSE`.

- **What is ported is the feature, onto the contracts of this package:** the mapping of a
  provider's fields, an algorithm (a token bucket, a circuit breaker), the formatting of header
  fields, and the test cases. The code lands on `Receipt`, `src/internal/http.js` and the injected
  options; the HTTP paths, retries and error models of the sources are not kept.
- **Known upstream bugs are fixed in the port,** unlike upyo's: in the same `feat:` commit, each
  with a test that fails on upstream's behavior and an entry in the list below (N for nodemailer,
  U for unemail, S for sently). A ported test that pinned upstream's behavior says "Changed in the
  port".
- A ported file starts with the header of its source, as for upyo:
  ```js
  // Ported from nodemailer v10.0.16 (src/sendmail-transport/index.ts)
  // https://github.com/nodemailer/nodemailer — MIT-0, Copyright 2011-2023 Andris Reinman
  ```
  The notice of unemail is `// https://github.com/productdevbook/unemail — MIT, Copyright 2025
  Wind`, that of sently `// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx
  contributors`. A file with a second source names it further down, `// Also ported from <name>
  v<version> (<path>)` followed by its notice. Ported test suites keep their `describe`/`it`, as
  upyo's do; the `expect` of vitest and bun:test becomes `node:assert`.
- **Not ported, on purpose:** the DKIM, SES over the AWS SDK, `addressparser`, `fetch`, `punycode`
  and plugin pipeline of nodemailer (this package does each better or has it); the SMTP client,
  MIME builder, DKIM, fallback, round-robin and retry of unemail (`./smtp`, `./mime`, `./pool` and
  `./retry` are safer); the `{{var}}` engine, SMS, WhatsApp and push, socket adapters, pool, retry,
  fallback, rate limiter and idempotency of sently (unemail's are the base where one is needed).

**Upstream bugs fixed in the port** (each in the `feat:` commit of the feature, with a test that
fails on upstream's behavior):

- N1. nodemailer: nothing wrote `List-Unsubscribe-Post` (a `list.unsubscribePost` key became
  `List-Unsubscribepost`), and the default DKIM `h=` of neither nodemailer nor unemail covered it
  or `List-Unsubscribe`, as RFC 8058 §4 requires. `oneClick` of `list` writes it, and the default
  `h=` of `./mime` ends with `list-unsubscribe:list-unsubscribe-post`.
- N2. nodemailer: any `path` or `href` of an attachment (and of `html` and `text`) was read, a
  file from disk or a URL through its own HTTP client, unless `disableFileAccess` and
  `disableUrlAccess` were set; the client followed five redirects to any address, cloud metadata
  included, with no bound on the body. In `./attachments` nothing is read but through `fromPath`
  and `fromUrl`, which the application calls; `fromUrl` goes through the injected `fetch` with
  `redirect: 'manual'`, checks each URL with `allowUrl` (by default `isPublicUrl`: no
  `localhost`, loopback, private or link-local address), sends `headers` to the first origin
  only, and bounds time and bytes.
- N3. nodemailer: a data URL over 50 MB became an empty attachment, and one that did not parse
  was read as a file path. `fromDataUri` refuses both and checks base64, and percent-encoded
  bytes stay bytes rather than going through `decodeURIComponent`.
- S1. sently (`resolveAttachments`): `basePath` compared the paths as written, so a symbolic link
  inside it led out of it. `fromPath` compares the `realpath` of the file with that of `root`.
- N4. nodemailer (`http-proxy-client.ts`): an IPv6 destination went bare into the CONNECT
  request line and Host field (`CONNECT ::1:25`), which a proxy reads as another port; an HTTPS
  proxy took `rejectUnauthorized` alone, no `ca` and no SNI; the credentials of the proxy URL
  went through without percent-decoding. `createHttpProxyConnector` (`src/smtp/http-proxy.js`)
  brackets it, passes the `tls` options and the proxy's name, decodes the credentials as UTF-8,
  and puts back what came with the reply in the paused socket. A connection opened by `connect`
  counts as local for plain-text AUTH only by its `host`, never by the proxy it reaches.
- N5. nodemailer (`sendmail-transport`): a process killed by a signal (`code === null`) was a
  success, the code of `close` was handed on as an error value, stderr was never read, the
  recipients followed the options with no `--`, and the message kept its Bcc field for the MTA to
  strip. `./sendmail` succeeds on an exit with 0 alone, reports a signal after the whole message
  as `deliveryUnknown`, classifies the sysexits codes, reads stderr bounded and redacted, ends the
  options with `--`, and puts blind recipients on the command line only.
- U4. unemail (`src/drivers/_fetch.ts`), behind every HTTP driver ported: redirects were followed,
  so `X-Postmark-Server-Token`, `api-key` and the other custom credentials went wherever one
  pointed; the body was read whole, with no bound; and a timeout or a 5xx after which the
  provider may have taken the message was retried by the middleware. The providers of 1.1 go
  through `createApiClient` (`src/internal/api.js`) on `requestWithRetry`, as the ported ones do.
- S2. sently (`src/transports/postmark.ts`): an inline part went with its Content-ID alone, while
  Postmark wants `cid:` before it, and the JSON of an answer was parsed before its status, so a
  non-JSON 5xx failed with a `SyntaxError` and no status. `./postmark` writes `cid:`, and the
  shared client reads the status first.
- U5. unemail (`src/drivers/brevo.ts`): a batch went as the `messageVersions` of one request
  when its messages agreed on the file names and lengths of their attachments, so a recipient
  could get another's file, and the idempotency key of a batch folded only the keys present, so
  two batches could share one. `./brevo` sends single requests, each with its own key, generated
  when the message has none, so a retry after an unknown delivery cannot send twice; Brevo's
  `duplicate_parameter` is reported as `deliveryUnknown`.
- U6. unemail (`src/drivers/mailersend.ts`): `sendBatch` went through the bulk endpoint, which
  answers with one `bulk_email_id` for every message and accepts what may fail later, so each
  receipt said "sent" for a message whose fate was unknown. `./mailersend` sends single requests,
  the id of each the `X-Message-Id` of its answer. sently's MailerSend driver dropped custom
  headers; they are sent, with the threading fields and List-Unsubscribe in MailerSend's own.
- U1. unemail (`src/core/message.ts`): `List-Unsubscribe` was built from the `unsubscribe` URL
  after the check for line breaks in header values, so a CR or LF in the URL added header fields.
  `listFieldsOf` (`src/core/list.js`) refuses whitespace, controls and angle brackets in a URL and
  writes what `URL` serializes.
- U2. unemail: one-click went with any `unsubscribe.url`, `http:` included, and was on by
  default. RFC 8058 §3.1 asks for an https URI; `oneClick` is opt-in and needs one.
- U3. unemail: the keys and values of `metadata` became `X-Metadata-<key>` header fields in eight
  drivers with no check, so a key or value with a line break added header fields. `createMessage`
  holds a key to 1 to 128 of `[A-Za-z0-9_.-]` and a value to a string without control characters.
- S3. sently (`src/transports/sparkpost.ts`): cc and bcc recipients went into `recipients` with no
  `header_to` and no Cc field, so the message lost its Cc field and each copy named only its own
  recipient in To; every address was reported accepted whatever `total_rejected_recipients` said,
  and an answer without an id was a success with an empty one. `./sparkpost` gives each recipient
  the shared To in `header_to` and the Cc field in `content.headers`, counts the rejected ones on
  the receipt (`rejectedRecipientCount`), fails it as `rejected` when none was accepted, and
  reports an answer without an id as `deliveryUnknown`.
- U7. unemail (`src/drivers/azure-communication.ts`): with no option the connection string came
  from `COMMUNICATION_SERVICES_CONNECTION_STRING` of `process.env`, an endpoint could be `http:`
  to any host, and its idempotency was the `Operation-Id`, while the API takes a repeat as one
  only by the `Repeatability-Request-Id` and `Repeatability-First-Sent` of OASIS Repeatable
  Requests, which it never sent; tracking with opens on and clicks off turned both on. `./azure`
  reads only its options, holds the endpoint to HTTPS or loopback HTTP, sends both headers with
  the key as `Operation-Id` too, reports a repeat Azure answers 409 or 412 as `deliveryUnknown`,
  and refuses tracking it cannot express.
- U8. unemail (`src/drivers/scaleway.ts`): an inline attachment went as an ordinary file without
  its Content-ID, which the API has no field for, so the `cid:` of the HTML matched nothing.
  `./scaleway` refuses it before the request.
- U9. unemail (`src/drivers/cloudflare-email-rest.ts`): the REST driver wrote the addresses as
  `{ email, name }`, the reply-to as `replyTo` and the Content-ID as `contentId`, the shapes of the
  Workers binding, where the REST API takes `{ address, name }`, `reply_to` and `content_id`
  (Cloudflare's API reference and SDK 7.3.0); and the receipt's id was made of the delivered
  addresses and the clock, which put the recipients into every log of a receipt and could repeat
  within a millisecond, while the answer has a `message_id`. `./cloudflare` writes the REST
  shapes and takes the `message_id`.
- U10. unemail (`src/middleware/circuit-breaker.ts`): half-open let every send through, not one
  probe, so a provider coming back met the whole backlog at once; any failure but a malformed
  message counted, a rate limit and a caller's abort among them. `./breaker` lets one probe
  through, answers the others as while open, counts only network, timeout, server and
  unavailability failures and a thrown error that is not the caller's abort, and ignores a late
  result of a send made in another state.
- U11. unemail (`src/middleware/rate-limit.ts`): the wait for tokens did not hear the caller's
  signal, so an aborted send kept its place and its tokens; `maxWaitMs` counted from the turn of
  a message, not its arrival, so one queued behind others waited past it; and a batch costing
  more than the capacity was cut to it and went through, over the limit. `./ratelimit` serves the
  waiters in turn from one timer and drops one whose caller aborts, refuses at once a message the
  queue ahead would hold past `maxWaitMs`, and refuses a cost over `burst`.
- U12. unemail (`src/middleware/idempotency.ts`): the key was looked up before the send and
  written after it, so two concurrent sends under one key both went; the same key for another
  message was answered with the first's receipt; and only successes were kept, so a send of
  unknown delivery went again on a retry. `./idempotency` reserves the key in the store first
  (`reserve`, `complete`, `release`), answers a send in flight as of unknown delivery, refuses a
  key whose fingerprint differs, keeps a key whose delivery is unknown, and fails only the
  message whose store call failed.
- S4. sently (`src/mailer.ts`): `onRetry` and `onFallback` were set on the shared transport for
  each send and unset when it ended, so of two concurrent sends one told its retries to the
  other's hooks, and the first to end unset the hooks of the other; a hook that threw was written
  with `console.warn` outside production and dropped in it. `./hooks` makes the context of each
  send and passes `onRetry` in the options of that send, and a hook that throws after the send
  becomes a process warning (`MAILER_HOOK_FAILED`).
- U13. unemail (`src/drivers/tee.ts`): every leg was awaited with no bound, so the primary's
  result waited for the slowest mirror, and a mirror that hung held the send for as long as it
  hung. `./tee` gives each mirror a timeout of its own and by default does not await it, bounds
  the copies in flight, and awaits them, bounded, only with `awaitMirrors`.
- U14. unemail (`src/render/_html.ts`, `src/render/react.ts`): `htmlToText` threw a RangeError on
  a numeric reference past U+10FFFF (`&#99999999;`), left comments and the doctype in the text
  (React Email writes `<!--$-->` into every body), read an `href` in double quotes only, and its
  lazy patterns rescanned the rest of the input for each unclosed `<a` or `<script`, quadratic in
  its length (reproduced); the React renderer imported `@react-email/render` itself and hid a
  failed plain-text pass. `./render` reads HTML in one linear pass (`html-to-text.js`), decodes
  an invalid number as U+FFFD, takes `render` as an option and lets its failure through.
- S5. sently (`src/webhooks/ses.ts`): the SNS message was parsed and never verified, so anyone
  who knew the URL could post bounces and complaints; a notification of several recipients
  became one event, of the first; a Permanent and a Transient bounce were both `bounced`; and a
  reject or a rendering failure, which SES never attempted, was a bounce. `./webhooks` takes an
  SNS message only from a listed topic, signed (versions 1 and 2) with the certificate of an
  `sns.<region>.amazonaws.com` URL read through the injected `fetch`, within an hour and once;
  it makes an event per recipient, says whether a bounce is hard or soft, makes a reject
  `rejected`, and hands a subscription confirmation to the caller.
- S6. sently (`src/webhooks/{resend,sendgrid,mailgun,postmark}.ts`): `parse` was exported apart
  from any check; SendGrid's signature and Postmark's credentials were never checked; Resend's
  and Mailgun's signatures were, with no window of time and no replay check, and a Resend secret
  that was not base64 threw at each request. An unsubscribe was a spam complaint (SendGrid,
  Brevo), a drop or a suppression a bounce (SendGrid, Mailgun), a block a deferral (SendGrid), a
  failed Resend email a bounce, and every Postmark bounce `bounced` whatever its type.
  `./webhooks` verifies first: Svix for Resend, ECDSA P-256 for SendGrid, HMAC for Mailgun, all
  within five minutes and once by id; Basic credentials, required, for Postmark.
- S7. sently (`src/webhooks/brevo.ts`): any request was parsed, Brevo signing nothing; a blocked
  or invalid address and a soft bounce were all `bounced`, and an unsubscribe a complaint.
  `./webhooks` requires the token the webhook is configured with (`Authorization: Bearer` or a
  custom header), compared in constant time; a blocked or invalid address is `rejected`, a soft
  bounce soft, and the metadata comes back from `X-Mailin-custom`, as `./brevo` sends it.
  MailerSend, Mailtrap, Mailjet and SparkPost, which sently and unemail lack, are verified from
  their documentation: an HMAC of the body (MailerSend, Mailtrap; no time is signed, so each
  event is taken once by its id for a day and an hour), Basic credentials (Mailjet, SparkPost).
  So are Lettermint (HMAC of the time and body), Maileroo (HMAC of the body), SMTP2GO (Basic),
  Azure (Event Grid, a token in a secret delivery property, the validation handed back) and
  Scaleway (SNS messages of Topics and Events, the certificate checked against the trust chain
  the application pins). ZeptoMail, whose signing is not documented, Plunk, which posts no
  events, and Cloudflare, whose events go to a Queue, have none.

**Bugs of 1.1 found in review before its release** (each in its own `fix:` commit, or `perf:`,
with a test that fails without it; R for review):

- R1. webhooks: an id was kept as taken inside `verify()`, before the application handled its
  events, so a delivery whose handler failed came back as a replay, was answered 2xx and lost;
  and a store was made silently per verifier, which neither several processes nor a verifier
  made per request share. `verify()` reserves the id for `leaseMs` and returns the events with
  `commit()` and `release()`, over a store of `reserve`, `commit` and `release` (`claimDelivery`
  in `request.js`); another delivery meanwhile is `pending` (503); `replayStore` is required,
  `null` to keep none; a refusal carries the `status` to answer.
- R2. render: `htmlToText` read the end of a string built with `+=`, which V8 flattens at each
  read, so 1 MB of HTML took ten seconds, against the "linear" of U14. The text is built in
  chunks, its last character and trailing whitespace kept aside.
- R3. attachments: the media type in the pattern of `inlineDataUrls` was unbounded, quadratic on
  `<img src=data:x` repeated; `isPublicUrl` judged the host as written, so a name resolving to a
  private address passed, and so did NAT64, 6to4, site-local, multicast and reserved ranges; a
  redirect could go from https to http. The type is bounded, the default `allowUrl` resolves the
  name (`lookup`) and checks every address, and a downgrade is refused; DNS rebinding between
  the check and the connection stays, as the docs say.
- R4. attachments: `fromPath` checked the real path once and read the file later, with no bound.
  It takes `maxBytes` (25 MiB), and each read checks the path again and that the file is the one
  checked (`dev`, `ino`).
- R5. webhooks: SNS read the certificate of any `SigningCertURL` on an `sns.*.amazonaws.com` host,
  its path and query unchecked, behind a cache keyed by the whole URL, so a query per request
  made a read per request; Azure handed back a `validationUrl` of any host. The SNS path must be
  `/SimpleNotificationService-<id>.pem` with no query, four reads at most at once, and
  `certificateTimeoutMs` and `signatureVersions` are options; a `validationUrl` must be on
  `*.eventgrid.azure.net`, and a token is checked when the request carries one.
- R6. smtp: `createHttpProxyConnector` sent `Proxy-Authorization` over `http:` to any host and had
  only an idle timeout. Credentials go in clear to a loopback proxy alone, unless
  `allowPlaintextCredentials`, and the CONNECT has one deadline.
- R7. ratelimit: `maxKeys` only started a sweep, so the buckets grew without bound; disposal left
  its timers and waiters; an abort between the messages of a `sendMany` was not heard. The least
  recently used bucket goes past `maxKeys`, disposal rejects the waiters with an `AbortError`,
  and each wait checks the signal.
- R8. tee and every warning of a decorator: disposal closed the mirrors with copies in flight; a
  failed copy, a hook or a store that threw became a warning with its raw text, addresses
  included, one per failure. Disposal waits for the copies, a copy carries the primary's
  Message-ID, and warnings are redacted (`describeThrown`) and held to ten a minute per code
  (`warnLimited`, `internal/callback.js`).
- R9. idempotency: one `ttlMs` held a reservation and a result, so a crash or a `break` after
  `reserve` left the key pending for a day, every send of it `in_flight`; a holder whose time
  ran out could complete another's reservation; the receipts of the decorator had no category
  and were classified by the words of the key (`order-timeout-1` was a `timeout`). A reservation
  has `leaseMs` (10 minutes) and a token that `complete` and `release` take, a message abandoned
  is released, and every receipt names its category.
- R10. core, pool: a refusal by a provider's limits before any request (`scheduledAt` where it
  cannot schedule, a second tag for Postmark) was `validation`, at which `./pool` stops its
  failover. It is the category `unsupported`: not retried, failed over, not counted by the
  breaker.
- R11. mailtrap: its own `parseRetryAfter` had not the bound of bug 29, and gave 0 for a past date.
  It uses the core one.
- R12. the gate of the decorators (`internal/gate.js`): a `sendMany` its caller left (`break`) did
  not settle the messages read ahead, so a probe stayed out, keys stayed pending and hooks went
  unheard; and every answer given in place ended the wrapped `sendMany`, cutting the batches of a
  batch API to one or two messages. `abandon` settles them in a `finally`, and one wrapped
  `sendMany` runs, the answers in place put in the order of their messages.
- R13. breaker: a probe that never ended kept the circuit half-open for good, an `isFailure` that
  threw broke its state, a failed batch counted a failure per message, and a late result counted
  in a later period. A probe has `probeTimeoutMs`, the callbacks are guarded, a batch counts one
  failure, and a result counts in the period it was sent in.
- R14. sendmail: no timeout, no bound on the processes, success on an exit with 0 before the whole
  message was written, and an abort sent SIGTERM alone. `timeout` (60 seconds; SIGTERM, then
  SIGKILL 5 seconds on; `deliveryUnknown` once the message was written), `maxConcurrent` (10),
  and such an exit fails.
- R15. postmark, mailjet: a batch was cut by its count alone (500, 50), so its attachments were
  held whole and could pass the provider's limit, which refuses the whole batch. It is cut by its
  bytes too (50 MB, 15 MB).
- R16. hooks: the hooks had no signal, a rejection of an async `onRetry` went unheard, and
  `beforeSend` could return anything. The context carries the signal, an abort during
  `beforeSend` sends nothing, a rejected `onRetry` is a warning, and a value not shaped as a
  message refuses it.
- R17. breaker, ratelimit, the memory stores and the replay store: intervals on `Date.now`, which
  a step of the clock moves. They are measured on `performance.now()`.
- R18. webhooks: Basic and Bearer credentials were compared with an early exit on a length apart;
  the store was given ids as they came, one of which names a recipient (Mailtrap without
  `event_id`); the verifiers of providers that sign no time took `toleranceMs` and `now` and
  never read them; a batch reserved its ids one round trip at a time. Credentials compare as
  HMACs, the store is given a SHA-256 of each id, those options throw, and the store is called
  64 ids at a time.
- R19. core: `metadata` had no bound on its keys or values. 64 keys, values of 1024 characters.
- R20. webhooks: the mapping of events guessed where the provider did not say. An Azure
  engagement of any type but a click was an open, and a quarantined message deferred, which
  Azure does not try again; a Mailgun failure of no severity, a SendGrid bounce of no type and a
  Mailjet bounce without `hard_bounce` had a kind (and SendGrid's `expired`, given up after its
  retries, was hard); a Resend bounce without its detail and an SES bounce of no recipient had
  none; Postmark made any undocumented bounce type a bounce, and any suppression an
  unsubscribe. The rule of `docs/guide/webhooks.md` (`deferred` while the provider tries again;
  `bounced` hard, soft or undetermined as it says; `rejected` with nothing sent; `unknown` rather
  than a guess) holds for all, and `tests/unit/webhooks-mapping.test.js` pins every provider's
  table.

## Repository layout

```
index.js  index.d.ts   root entry shim + hand-written types
src/
  index.js          public barrel (explicit named exports)
  version.js        the package name and version (OpenTelemetry scope), kept equal to package.json
  <subpath>/        one directory per subpath: index.js + index.d.ts + its modules
  internal/         private modules shared by subpaths, not in the exports map: the request
                    layer (http.js, api.js for the providers of 1.1, body.js, unsent.js,
                    delivery-unknown.js, config.js, loopback.js, validate-ssl.js, verify.js),
                    receipts (provider.js, refusal.js), message fields (headers.js, raw.js,
                    schedule.js, tracking.js, capabilities.js, batch.js, base64.js, uuid.js),
                    the decorators of 1.1 (gate.js, callback.js, options.js, decorator.js),
                    and redact.js, redact-addresses.js, sleep.js, log.js
tests/
  unit/*.test.js    node:test suites, one per area (<subpath>-<module>.test.js for a subpath)
  runtime/*.test.js the package by its name on Node, Bun and Deno, with no mock
  helpers/<sub>/    shared test code of a subpath (fake servers, fixtures builders)
  fixtures/<sub>/   static fixtures (certificates; tls/ is a CA and a certificate it issued)
  types/*.test-d.ts tsd assertions, one file per entry
scripts/
  size.js           bundle-size report; --check gates each entry of the exports map
  size-budgets.json the min+gzip budget of each entry in KB (the root, and each subpath on top)
  check-dts.js      tsc --strict over the d.ts of every entry of the exports map
  check-pack.js     the tarball holds every file of the exports map and nothing outside `files`
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
  (auth, rate-limit, network, timeout, validation, rejected, unsupported, server-error,
  service-unavailable, configuration, unknown), `retryable`, `statusCode` and
  `retryAfterMilliseconds`; `classifyHttpStatus` and `classifyReceiptError` classify. A transport
  reports a failure in a receipt rather than by throwing.

The contracts of the reliability layer, still to be designed (Phase 0):

- **`QueueDriver`**: enqueue, reserve, ack, retry with a delay; drivers for an outbox in MongoDB,
  BullMQ and an in-memory one for tests.
- **`AuditSink`**: append-only records of state changes; sinks for MongoDB, stdout/OTel logs and a
  custom one.
- **The states and events of a message:** `queued → rendered → submitted → accepted → delivered |
  bounced | complained | failed | delivery_unknown`, with correlationId, tenantId, attempt, the
  provider's message id and a hash of the payload.
- **`DeliveryEvent`** (root types, 1.1), what `./webhooks` reads from a provider: one per message
  and recipient, its `id` the same on every redelivery, its `messageId` that of the receipt.
  `accepted`, `delivered`, `bounced` and `complained` are the states above; `rejected` is
  `failed` before any attempt; `deferred` keeps a message `accepted`; `opened`, `clicked` and
  `unsubscribed` are engagement, not states; `unknown` keeps the provider's `raw` record.

## Roadmap

From the comparison of 14 Node.js email libraries (`docs/comparison.json`, 2026-10-07). The market
is not short of providers or SMTP clients; it is empty in the reliability layer. P0 is required for
a first release, P1 for an advantage over the alternatives, P2 after the first release.

**Phase 0, contracts.** The message and its builder, `Transport`, `QueueDriver`, `AuditSink`, the
model of states and events. `tenantId` is in the context from the start.

**Phase 1, reliable sending (P0).**

- **The transport of its own** (done, ported from upyo 0.7.0; its known bugs are on the list of
  "Code ported from upyo"): the MIME builder; the SMTP client (pool, STARTTLS with `requireTls`,
  not RFC 8689 REQUIRETLS, AUTH PLAIN/LOGIN/XOAUTH2, DSN, PIPELINING); DKIM (RSA-SHA256, Ed25519);
  SES v2 over `fetch` with SigV4; seven more HTTP providers and JMAP. 1.1 added sendmail and ten
  providers.
- **A persistent queue:** the outbox in MongoDB (transactional outbox, no Redis needed) and a
  BullMQ driver (Valkey) for throughput and delays; priorities (auth codes before newsletters).
- **The audit log** of every state, with a keyed HMAC plus an encrypted block for the recipient
  (crypto-shredding), so the right to erasure does not fight an append-only log. 3–6 records per
  message; optional hash chain for tamper evidence.
- **Idempotency:** a deterministic key (tenant + purpose + recipient + window) deduplicated in the
  outbox. At least once with deduplication, never a promise of exactly once. A provider without an
  idempotency key (SES) leads to `delivery_unknown` and reconciliation from events, not to a blind
  retry. `./idempotency` (1.1) reserves keys in a store of `reserve`, `complete` and `release`,
  which the outbox is to implement.
- **Errors classified:** permanent (5xx, rejected address) are not retried; temporary ones are,
  with jitter and `Retry-After`, under an attempt limit.
- **The correctness suite:** golden `.eml` files, DKIM checked by an independent verifier in CI,
  fuzzing of header injection, `multipart/related`, dot-stuffing and IDN. The reference must be
  external: tests that only pin the library's own output prove nothing (sently's "RFC" tests pin a
  wrong result).

**Phase 2, a closed loop (P1).** Webhooks of the providers into the one event model, with the
signature mandatory and replay protection (done in 1.1: `./webhooks`, fifteen providers); a
suppression list per tenant and stream, checked before a message is queued, with a bypass policy
for transactional mail (password reset, MFA); failover over a pool of providers with health, a
circuit breaker with a single probe in half-open, and no switch after an ambiguous "submitted"
without an idempotency key (`./pool` has strategies and failover, `./breaker` of 1.1 takes a
failing provider out of it; no health checks yet); OpenTelemetry spans and metrics (time in
queue, attempts, failure rate per provider, outbox size; `./otel` covers sends); token-bucket rate
limits per provider and per tenant (SES quotas; `./ratelimit` of 1.1, by any key, with a
store of buckets that processes share).

**Phase 3, multi-tenant (P1–P2).** Provider credentials per tenant (bring your own SES), domains
and DKIM per tenant, quotas; List-Unsubscribe one-click (RFC 8058, done in 1.1) and the split
between transactional and bulk mail; scheduled sending as a queue delay (1.1 schedules through the
providers that can); a `Renderer` interface with an optional React Email adapter (no template
engine of its own; done in 1.1, `./render`); more providers (done in 1.1).

**Decisions:**

- **The transport is ported from upyo, not a wrapper over Nodemailer.** The comparison advises
  against rewriting SMTP (Nodemailer has 15 years of edge cases). Upyo already has the transport
  this roadmap planned, on the same platform (zero dependencies, `node:net`, `fetch`), so it is
  ported file by file instead of written anew; its known bugs are fixed afterwards (see "Code
  ported from upyo"), and the correctness suite of Phase 1 still applies to it.
- **BullMQ is one driver, not the base:** it ties the queue to Redis/Valkey; the MongoDB outbox
  gives a queue with no new infrastructure.
- **Eighteen providers, then few new ones.** The eight HTTP providers of upyo came with the port;
  1.1 adds the ten most used of unemail and sently (Postmark, Brevo, Mailjet, MailerSend,
  SparkPost, ZeptoMail, SMTP2GO, Azure Communication Services, Scaleway and Cloudflare). Each
  provider adds its webhooks and API drift to maintain, so another one waits for a user who needs
  it.

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

Node.js ≥ 22 is the target: `engines` is `>=22.0.0`, and CI runs 22 and 24 on Linux and Windows.
Bun 1.4.3 and Deno 2.9.6 run the unit suite and `tests/runtime` in CI too, on Linux, through
their Node compatibility; their versions are pinned in `ci.yml` and named in the docs
(getting started), and `engines` names neither. A Deno user imports `npm:@alexify/mailer`. What
differs on them, as of those versions:

- **Deno's `fetch` sends a request again** when a reused HTTP/1.1 connection closes before its
  answer (hyper retries it), so a message the provider took may go twice where Node and Bun
  report it as `deliveryUnknown`; upstream streamed the JMAP bodies against it (bug 81), and the
  HTTP providers always sent a buffer. A streamed body or a client that keeps no idle connection
  stops it. The docs give Deno users a `fetch` on `Deno.createHttpClient({ poolMaxIdlePerHost:
  0 })` (known issues, getting started), rather than the library sniffing the runtime;
  `tests/runtime/http.test.js` pins both the replay and that `fetch`.
- **Deno's permissions:** `--allow-net`; `--allow-read` for `fromPath`; `--allow-run` and
  `--allow-env` for `./sendmail` (its `child_process` passes the environment on); and
  `--allow-sys=hostname` for the default EHLO name, which is `[127.0.0.1]` without it.
- **Bun's TLS (BoringSSL)** takes no self-signed certificate that is not a CA as a root of
  trust, as Node and Deno do, so the tests that pass `ca` use `tests/fixtures/tls`.

There is no `browser.js` and no `browser` field: sending from a browser would expose the
credentials, and SMTP needs sockets. `src/` may use `node:*` modules freely. Edge runtimes are not
a target for now; if they become one, the transport over `fetch` and the core would move behind a
separate entry with no `node:*`, and a platform test would enforce it as in protoarray.

## Conventions (oxlint/oxfmt + review)

- Formatting: 2 spaces, single quotes, semicolons, trailing commas, **100 columns**, LF
  (`.oxfmtrc.json`, `.editorconfig`). Lint: `.oxlintrc.json` (shared with protoarray: the explicit
  rule list, plus the `correctness` and `suspicious` categories as errors and `no-console`
  everywhere but `scripts/`, `bench/` and the opt-in suites, `tests/e2e/` and `tests/helpers/`).
  The code style below is enforced where a rule exists: `func-style` (expressions),
  `no-nested-ternary` and `max-depth` 4 everywhere; in `src/`, `no-restricted-properties` on the
  array iteration methods, the unicorn rules `no-array-for-each`, `no-array-reduce`,
  `no-useless-spread` and `prefer-set-has`, and `max-lines-per-function` 80 as a warning.
  Suppress a rule only for an intentional construct, with a targeted
  `// oxlint-disable-next-line <rule>`; `pnpm lint` fails on a directive that suppresses nothing.
- Code style:
  - module-level functions are arrow functions assigned to `const`; classes and prototype objects
    use method shorthand; no `function` declarations;
  - `Object.create(null)` for dictionaries;
  - **loops, one pass, keyed collections** (stricter than the metaskills): `src/` uses no array
    iteration method (`map`, `filter`, `some`, `every`, `find`, `findIndex`, `findLast`, `reduce`,
    `flatMap`, `forEach`), cold paths included, but `for` and `for…of` loops, index loops on hot
    paths (bytes, characters, lines, the messages of a batch), with no destructuring in them;
    whatever a collection gives is computed in one pass with an early exit, never in chained
    passes (`.map().join()`, `Object.entries().filter()`), and no array is made only to be
    iterated (a spread iterable, `Array.from(string)`, `split` only to test); membership goes
    through a module-level `Set`, keyed lookups through a `Map` built once, and caches or
    metadata on objects the library does not own (a `Message`, a config, a transport) through a
    `WeakMap` or `WeakSet` rather than a property on them. Plain objects stay for fixed shapes,
    and `tests/`, `scripts/` and `bench/` are exempt;
  - prefer `const`; no `var`;
  - private class members with `#`.
- Built-ins with the `node:` prefix; relative requires always end in `.js`.
- Self-descriptive code; comments explain *why*, not what.
- Conventional Commits (`feat(scope):`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`, `refactor!:`).

## Skills

`.claude/skills/` holds the seven [metaskills](https://github.com/metarhia/metaskills) v1.0.5
skills: `js-conventions`, `js-data-structures`, `data-structures`, `metautil-data-structures`,
`js-gof`, `error-handling` and `npm-publish`.

- **`js-conventions` is adapted to this toolchain** (the same copy as protoarray, plus the rule of
  loops, one pass and keyed collections from "Conventions", which replaces upstream's "use array
  methods when they improve readability"): oxlint/oxfmt instead of ESLint/Prettier, pnpm, 100
  columns, plus a Modules section (CommonJS, no `'use strict'`, `node:` prefix, `.js` in relative
  requires). Its other naming, best-practice and optimization rules are upstream's.
- **`npm-publish` is adapted to the release process below:** pnpm commands, the `prepublishOnly`
  gates (the size gate and the tarball check among them) plus the CI ones (comparison drift, docs
  build), this CHANGELOG's format, docs and
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
- `tests/unit/scripts.test.js` checks that every entry of the exports map has a budget in
  `scripts/size-budgets.json` and nothing else does, and runs `scripts/size.js --check` with
  budgets it always meets, budgets it never can and a missing one.
- **Size budgets** (`scripts/size-budgets.json`, min+gzip KB, the root alone and each subpath on
  top of it) are raised in the commit whose change needs the room, never in one of their own, by
  the smallest half-KB step that passes, and that commit's message says what took it. A budget is
  lowered when its entry falls a whole KB under it. The root is in the bundle of every subpath, so
  it grows only for the contract they share; what one subpath needs stays in that subpath.
- New behavior needs a test that fails without the change. Network transports are tested
  against local fake servers (`tests/helpers/smtp/mock-smtp-server.js` on `node:net`, servers on
  `node:http`) or a stubbed `fetch` (`t.mock.method(globalThis, 'fetch', …)`), never against a
  real provider in `pnpm test`.
- **Opt-in suites**, outside the gates: `tests/mailpit/` (`pnpm test:mailpit`, serial, as the
  inbox is shared; `docker compose -f tests/mailpit/docker-compose.yml up -d` and
  `MAILPIT_SMTP_HOST`/`MAILPIT_API_URL`, plus `MAILPIT_SENDMAIL="docker exec -i mailer-mailpit
  /mailpit sendmail"` for the sendmail case) and `tests/e2e/` (`pnpm test:e2e`, each suite skipped
  until its provider's variables are set; Stalwart for JMAP in `tests/e2e/jmap/`; the providers of
  1.1 in one table, `providers.e2e.test.js`, which also checks that refused credentials are a
  non-retryable `auth` failure). The release skill asks for them before a release.
- **Platform-dependent tests:** the mock SMTP server takes a client that has gone as no failure:
  a reset (`ECONNRESET`; macOS and Windows send an RST where Linux sends a FIN) and a reply
  written after the client closed (`EPIPE` on Linux, `ECONNABORTED` on Windows), which the 221 to
  `QUIT` can always meet, as `quit()` does not wait for it; macOS reports neither, so only CI
  catches a new one, and Docker (`node:22-bookworm-slim`) reproduces Linux. The JMAP test of a
  401 to a raw message of unknown size, which streams, is `todo` on Node 24 (known upstream bug
  14). `tests/unit/export-parity.test.js` also checks that every d.ts using `AsyncDisposable`
  references `esnext.disposable` itself.
- **`tests/runtime/`** runs the package as a consumer does, by its name, with no mock: every entry
  required and imported by name; SMTP over plain TCP, implicit TLS, STARTTLS and an HTTP CONNECT
  proxy, with DKIM checked by `tests/helpers/mime/verify-dkim.js`; an HTTP provider and
  `fromUrl` on the runtime's own `fetch` (a redirect, a body over 4 MiB, a lost answer); and
  `./sendmail` spawning a shell script (POSIX only). The same files run on Node, Bun and Deno, so
  they use `node:test` and `node:assert` alone, never `t.mock`.
- **Bun and Deno** (`pnpm test:bun`, `pnpm test:deno`) run each file in a fresh global
  (`--parallel`), as `node --test` runs each in a process of its own; in one global, the mocks of
  one file reach the next. Deno keeps mocked timers enabled after a test (`t.after` resets
  them), a TLS server reads no SNI as `null` on Deno and `undefined` on Bun (`false` on Node), the
  JMAP tests of a lost answer are skipped on Deno, whose `fetch` sends it again, and the import
  by name of `export-parity` spawns the node CLI, which Deno is not.

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
  a diff. The first library of the data is @alexify/mailer itself (this repository, with 🔜 for
  the roadmap), which `custom.css` tints in the brand teal as the second column and pins beside
  the features from 768px up; keep its cells true to the code when behavior changes. The page
  takes the full width through `.VPDoc:has(.ml-matrix)` in `custom.css`. The findings in cells
  come from reading the code and, except for emailjs, were not reproduced; the page says so, and
  a bug claim should be reproduced before it is made stronger.
- The brand is a teal "envelope" mark (`#0D6B63`, `#4CC2B5` on dark; a placeholder until a final
  logo): `docs/public/logo-mark*.svg`, `favicon.svg` (follows `prefers-color-scheme`),
  `favicon.png` and `logo.png` (the 1200×630 og:image, rendered from SVG with `rsvg-convert`).
- **The guides of upyo are adapted, not generated:** `docs/messages/` (compose, attachments,
  calendar, MIME) and `docs/transports/` (one page per subpath, plus custom transports), with
  examples in CommonJS on `@alexify/mailer/<subpath>`. `/transports/logger` is new (pino-like
  logger) and `/transports/otel` passes the providers in. The pages of 1.1 are new:
  `/messages/render`, `/guide/webhooks`, a page per provider and decorator, and Bun and Deno in
  getting started. One sidebar (`guide` in `config.mts`) covers the guide, the messages, the
  transports and the decorators.
- When behavior changes, update README and the matching docs page together. Keep example outputs in
  the docs true to the code.

## Release process

Manual, as in the sibling repositories. The `npm-publish` skill walks through it step by step:

1. Bump `version` in `package.json` and in `src/version.js` (`tests/unit/version.test.js` fails
   while they differ).
2. Turn `## [Unreleased]` in CHANGELOG.md into `## [X.Y.Z] - YYYY-MM-DD` and add its link
   reference.
3. Commit, then tag `vX.Y.Z`.
4. Run `pnpm run release` (`pnpm publish`, gated by `prepublishOnly`, which includes the size
   gate and the tarball check; `publishConfig.access` is public).
