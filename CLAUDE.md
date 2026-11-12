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
   of delivery events with the verified webhooks of fifteen providers (`./webhooks/<provider>`,
   an entry each since 2.0, over what `./webhooks` shares) and the
   idempotency decorator (`./idempotency`), whose store the outbox of 1.2 implements.
   1.2 adds the queue (`./queue`, a driver-neutral contract, its worker and a memory queue;
   `./bullmq`, the BullMQ driver; `./mongodb`, the transactional outbox with its audit sink and
   idempotency store), templates by name over nine engines passed in (`./templates`), the
   audit of the states of a message (`./audit`) and the spans and metrics of the worker
   (`instrumentHandler` of `./otel`). Jobs are signed (HMAC) and may be sealed (a codec), their
   message dropped once done with; sources hold one contract (leases, redelivery, fencing, a
   limit of runs that end unsettled), with tenants in turn and a pause per tenant.
3. **The other channels, from 2.0,** on the same reliability layer: SMS and RCS; WhatsApp,
   Messenger and Instagram; Telegram and Viber; Slack, Discord, Microsoft Teams and Google Chat;
   and push (FCM, APNs, Web Push), nineteen providers each through its own HTTP API (see "Code
   ported for the channels"). One message model (`Message` for email, `ChannelMessage` for the
   others), one queue, one audit, one model of delivery events, and in 2.1 one suppression list
   and one fallback across the channels and email. They were planned as the sibling library
   `@alexify/messenger`, which is not published; its comparison and its rules moved here.
   `PLAN-channels.md` is the plan of 2.0 to 2.2, in stages.

It has zero runtime dependencies and runs on Node.js ≥ 22, and on Bun and Deno through their
Node compatibility (see "Platform"; no browser entry).

**Status: 1.2 is the transport and the reliability layer on it.** The root entry exports the
message model and the transport contract of upyo, with the delivery events of 1.1 and the
contracts of the reliability layer of 1.2 as types; each transport, decorator, driver and helper
is a subpath, and their API is under semver from 1.0.0. The crypto-shredding of the audit and
suppression have no API yet; their direction is in "Roadmap" below. **2.0, the channels, is being
built** on `feature/messenger` after `PLAN-channels.md`; no channel is in the code until its
stage 2 lands the contracts, and 2.0 is the major in which names and import paths change once
(see "The channels" in "Roadmap").

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
pnpm test:bullmq                   # opt-in: tests/bullmq on BullMQ and Valkey (compose file there)
pnpm test:mongodb                  # opt-in: tests/mongodb on a MongoDB replica set (compose file there)
pnpm test:stores                   # both above, failing (not skipping) without MONGODB_URL and BULLMQ_REDIS_URL
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
pnpm docs:comparison               # renders docs/comparison*.json into docs/guide/comparison*.md
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
  it is declared. A subpath may nest in another: `./webhooks/ses` is `src/webhooks/ses/`, whose
  modules may require those of `src/webhooks/` (the request layer of the webhooks), never the
  other way, nor a sibling's. A subpath's d.ts imports the shared types from `'../../index.js'`.
  `tests/unit/graph.test.js` keeps `src/` free of require cycles and lets a subpath require
  another one only along the edges it lists.

## Zero dependencies: drivers are passed in

There is no `dependencies` or `peerDependencies` key in `package.json`, and there won't be one.

- **The transports are built on `node:*` and `fetch`:** SMTP on `node:net`/`node:tls`, DKIM and
  the SES SigV4 signature on `node:crypto`, HTTP providers on the global `fetch`. No provider SDK.
- **So are the channels (2.0):** the SMS and RCS APIs, Meta's Graph API, the bot APIs of Telegram
  and Viber, Slack's Web API, Discord's REST API, the webhooks of Teams and Google Chat, FCM and
  Web Push are HTTPS with JSON or form bodies over `fetch`. **APNs is the exception:** it
  requires HTTP/2, which Node's `fetch` does not speak, so it goes over `node:http2`. The JWTs of
  FCM (RS256, a service account) and APNs (ES256), the signatures of webhooks (HMAC, Ed25519) and
  the encryption and VAPID of Web Push (RFC 8291, RFC 8292) are `node:crypto`. The SDKs of the
  providers bring axios, `request`, `firebase-admin` and a dozen packages each.
- **No phone-number library.** E.164 validation and the segments of an SMS are small enough to
  write and test here, rather than bundling libphonenumber-js.
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
- **The HTTP clients are this package's, the API of each provider upstream's.** The fixes 24 to
  39 had to land in seven copies of the same client, and one missed a copy (Mailtrap, bug 29), so
  since 1.1 the clients of SES, Resend, SendGrid, Mailgun, Maileroo, Lettermint, Plunk and
  Mailtrap are their requests over `createApiClient` (`src/internal/api-client.js`), as those of
  1.1 are, SES's SigV4 signature the `authorize` of each attempt:
  what stays upstream's is the provider's side (its authorization, the messages it is read for,
  what its 2xx must hold, its error classes), passed in as hooks. Their public errors
  (`SendGridApiError`…) extend `ProviderApiError` with the names, arguments and fields of 1.0, and
  the transports build their receipts with `providerFailure`. JMAP, with its session, keeps its
  own client; `tests/unit/api.test.js` fails when another provider calls `requestWithRetry` on
  its own. The transports of 1.1 extend `ProviderTransport` (`src/internal/provider-transport.js`).
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

The known bugs of upstream (1–14) and those found and fixed after the port (15–89) are in
[`BUGS.md`](BUGS.md), "Code ported from upyo"; a new one adds its entry there.

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
  with a test that fails on upstream's behavior and an entry in `BUGS.md` (N for nodemailer,
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

The bugs of the sources fixed in the port (N, U, S) and those of 1.1 found in review before
its release (R) are in [`BUGS.md`](BUGS.md), "Code ported from nodemailer, unemail and
sently".

## Code ported for the channels

From 2.0 the package takes the features of the libraries of the channels where they lead, as 1.1
took nodemailer's, unemail's and sently's; none is a base to port file by file (§3 of
`PLAN-channels.md`, which says what each source gives and where it goes). The six MIT sources
whose code is ported have their notices in `LICENSE` and their entries in `SOURCES` of
`tests/unit/attribution.test.js`: @thinwrap/notifications 1.2.0, node-telegram-bot-api 2.1.0,
http_ece 1.2.1, message-segment-calculator 1.3.0, split-sms 0.1.7 and @parse/node-apn 8.1.1;
@visulima/notification, twilio-node, @slack/bolt, @slack/web-api and botframework-connector,
whose bugs were read but whose code no shipped file takes, left them before 2.0, and
`attribution.test.js` fails on a source no shipped file names. Their clones, read-only, are in
`~/Documents/open-source/messenger-alternatives/`, whose README indexes them.

- **What is ported is the feature, onto the contracts of this package** (`Receipt`,
  `createApiClient`, the injected `fetch`, the `signal`), not the HTTP layer, the retries or the
  error model of the source. Pure functions and tables may come nearly as written (the error
  tables of thinwrap, the signature of twilio-node, the record of http_ece, the GSM-7 table of
  message-segment-calculator).
- **A known bug of the source is fixed in the port,** in the same `feat:` commit, with a test
  that fails on the source's behavior and an entry in `BUGS.md`, under a prefix apart from
  N, U, S and R: V visulima, T thinwrap, NV Novu, TG node-telegram-bot-api and grammY, TW
  twilio-node, VG Vonage, SN Sinch, AP node-apn, FB firebase-admin, DC discord.js, SL the Slack
  SDKs, VB viber-bot, BB botbuilder, EC http_ece. §8 of the plan lists the bugs found so far. A
  ported test that pinned the source's behavior says "Changed in the port".
- A ported file starts with the header of its source, as for upyo, its path relative to the root
  of the package (in a monorepo, the package's directory):
  ```js
  // Ported from @thinwrap/notifications v1.2.0 (src/providers/twilio/twilio.connector.ts)
  // https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
  ```
  A second source is `// Also ported from <name> v<version> (<path>)` with its notice. A source in
  JavaScript names a file of its own layout (`lib/client.js` of node-apn, `ece.js` of http_ece).
- **The Apache-2.0 sources** (the SDKs of Vonage and Sinch, viber-bot, firebase-admin,
  discord.js) are written from the providers' documentation, their algorithms being a few lines
  each, so that the package stays MIT; their test vectors live in `tests/`, which is not
  published, with a line of attribution in the test file. `web-push` (MPL-2.0) and the WhatsApp
  Node SDK (Facebook Platform License) are not copied at all.
- Ported suites keep their `describe`/`it`; `expect` becomes `node:assert`,
  `vi.stubGlobal('fetch')` becomes `t.mock.method(globalThis, 'fetch')`, `vi.useFakeTimers`
  becomes `t.mock.timers`, and `vi.mock('node:http2')` a local h2c server.
- A source that no shipped file names when 2.0 is released leaves `LICENSE` and `SOURCES`.

The bugs of the sources fixed in the port (T, V, NV, TG, TW, VG, SN, AP, FB, DC, SL, VB, BB,
EC) and those of 2.0 found in review before its release (C) are in [`BUGS.md`](BUGS.md),
"Code ported for the channels"; a new one adds its entry there.

## Repository layout

```
index.js  index.d.ts   root entry shim + hand-written types
src/
  index.js          public barrel (explicit named exports)
  version.js        the package name and version (OpenTelemetry scope), kept equal to package.json
  <subpath>/        one directory per subpath: index.js + index.d.ts + its modules
  internal/         private modules shared by subpaths, not in the exports map: the request
                    layer (http.js, api-client.js for every HTTP provider but JMAP,
                    api.js for the conversions of the providers of 1.1, api-steps.js for
                    what a provider of any channel shares of them, body.js, unsent.js,
                    delivery-unknown.js, config.js, loopback.js, public-url.js (the check of
                    ./attachments and of Web Push), validate-ssl.js, verify.js, sigv4.js for
                    the services of AWS, jwt.js, token-cache.js, token-failure.js and google-auth.js for the
                    tokens of the channels, http2.js, a fetch over node:http2 for APNs),
                    receipts (provider.js, refusal.js, email-only.js), message fields (message-checks.js,
                    which every channel shares, headers.js, raw.js, schedule.js, tracking.js,
                    capabilities.js, batch.js, base64.js, uuid.js),
                    the decorators of 1.1 (gate.js, callback.js, options.js, decorator.js),
                    the base of the transports of 1.1 (provider-transport.js), what the
                    decorators and the queue share (backoff.js, thrown.js, fingerprint.js,
                    canonical-json.js, json.js, path.js), the driver of a QueueSource
                    (polling-driver.js), the messages of the channels (channel/: channels.js,
                    which ./router reads alone, message.js, phone.js and calling-codes.js,
                    segments.js and gsm7.js, markup.js, which ./channels exports and the
                    transports of the channels require, and recipient.js, the recipient of
                    one as a string for the decorators), job-channel.js (the channel of a
                    job without opening it, for ./bullmq and the spans of a worker), and
                    abort.js, iterate.js, warn.js, redact.js, redact-addresses.js, sleep.js,
                    log.js
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
  check-live-runs.js  every provider of a channel of the exports map has a live run recorded
  provider-places.js  where a provider is, to take out of a release that leaves it
  comparison.js     renders each docs/comparison*.json into its page of docs/guide/
bench/              zero-dependency ops/sec harness; baseline.json is a snapshot for --compare
docs/               VitePress site (mailerat.vercel.app), not published
  comparison.json   the feature matrix of 14 email libraries (the data of the comparison page)
  comparison-channels.json  the matrix of 11 libraries of SMS, chat apps and push
PLAN-channels.md    the plan of 2.0 to 2.2 (the channels), in stages
BUGS.md             the ledgers of the bugs fixed, of the sources and of the reviews
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

The contracts of the reliability layer (Phase 0), types of the root with no code, so that
`./queue`, `./bullmq`, `./audit` and a store's driver share them without requiring each other:

- **`QueueDriver`**: `enqueue`, `enqueueMany`, `consume(handler) → QueueConsumer`; a
  `QueueHandler` makes of each run of a job a `QueueOutcome` (`ack`, `retry` after a delay,
  `fail`, `release` without spending the attempt), and never throws. BullMQ is a driver
  (`./bullmq`); a store that lends its jobs (an outbox) is a **`QueueSource`** (`reserve`,
  `extend`, `ack`, `retry`, `fail`, `release`, fenced by the token of the lease), which
  `createPollingDriver` (`src/internal/polling-driver.js`) makes a driver of, as it does the
  memory queue. The queue retries, not the transport: a worker's chain has `retries: 1` and no
  `RetryTransport`.
- **A job** (`./queue`): JSON, a template with its context or content rendered already, its id
  a UUID of namespace, tenant and `idempotencyKey` (and the channel, for a job of a channel),
  and a SHA-256 of all but `enqueuedAt` that tells a duplicate from a key used again. An email
  job is `v: 1` with its Message-ID and Content-IDs fixed (derived from the id under a key of
  the caller's); a job of a channel is `v: 2` (see "One queue" below).
- **`AuditSink`**: `append(event, { transaction })`, append-only, an event written once by its
  deterministic `id`; sinks in memory, of a logger, and combined (`./audit`), and in MongoDB
  (`./mongodb`). The crypto-shredding of recipients is next.
- **The states and events of a message:** `queued → rendered → submitted → accepted → delivered |
  bounced | complained | failed | delivery_unknown`, with correlationId, tenantId, attempt, the
  provider's message id and the hashes of the payload and of the message; no recipient.
- **`DeliveryEvent`** (root types, 1.1), what `./webhooks` reads from a provider: one per message
  and recipient, its `id` the same on every redelivery, its `messageId` that of the receipt.
  `accepted`, `delivered`, `bounced` and `complained` are the states above; `rejected` is
  `failed` before any attempt; `deferred` keeps a message `accepted`; `opened`, `clicked` and
  `unsubscribed` are engagement, not states; `unknown` keeps the provider's `raw` record.

**The contracts of the channels** (2.0, `PLAN-channels.md` §4.1–4.2: the types of the root,
`./channels`, `./router` and the tables of `./audit` are in the code since its stage 2, the
shared layer since stage 3, and the decorators take a message of a channel since stage 4, with
the names of 2.0 (`message.*` log events, `mailer.message.*` metrics with `mailer.channel`,
`message.<state>` audit records), and the queue takes them since stage 5; the verifiers are an
entry per provider since stage 6, and the webhooks of the channels come in 2.1):

- **`ChannelMessage`**, built by `createChannelMessage()` of `./channels` (its modules in
  `src/internal/channel/`): `channel` (`sms`, `rcs`, `whatsapp`, `messenger`, `instagram`,
  `telegram`, `viber`, `slack`, `discord`, `teams`, `google-chat`, `push`), `to` (E.164 for SMS,
  RCS and WhatsApp, normalized with `defaultCountry`; a scoped id for Messenger, Instagram and
  Viber; a chat id or `@channel` of Telegram; none for the webhook of a work chat; a device token,
  a topic or a Web Push subscription), `from?`, `text`, `media`, `buttons`, a `payload` of the
  channel's own as JSON (Block Kit, an Adaptive Card, an embed, the overrides of a push),
  `mentions` (none unless allowed), `tags`, `priority`, `metadata` (`correlationId` there, as for
  email), `tenantId`, `idempotencyKey`, `scheduledAt`, `expiresAt`; WhatsApp's `template`,
  `thread` of four, and push's `title` and `data`. A field of another channel is refused.
  `Message` has `channel: 'email'` and `tenantId?`; a message without `channel` is email at run
  time. `AnyMessage = Message | ChannelMessage`, `MessageOf<C>`.
- **`Transport<TProviderId, TMessage extends AnyMessage = Message>`**, `VerifiableTransport`
  likewise; `RawTransport` stays email's. `./router` sends each message through the transport of
  its channel. A receipt gains `channel?`, `segments?` and `state?: 'accepted' | 'sent'` (a
  channel that reports no delivery, such as a work chat or push, stops at `sent`).
- **The categories of the channels:** `invalid-recipient`, `opted-out`, `outside-window` (the 24
  hours of Meta), `blocked` (the user blocked the bot), `not-on-channel` (a reason to fall back),
  `unregistered` (a push token or a subscription gone: drop it), none retried, and `unreachable`
  (the handset, for now), retried; `retryable` defaults from the category (`CHANNEL_RETRYABLE`
  of `core/receipt.js`), and no word of an error leads to them. `./pool` stops its failover
  at each of them but `unreachable`, which another route may reach (`STOP_FAILOVER`), and its
  transports are of one channel (a pool of several is a type error; `./router` sends them).
- **States and events:** the states gain `sent`, `read` and `expired` (ranks 3.5, 4.5 and 4, as
  the ranks of 1.2 are persisted); `DeliveryEvent` gains `sent`, `read`, `failed`, `expired` and
  `subscribed`, a required `channel` (`email` for the verifiers of 1.x) and
  `error?: { category, code }`. An inbound STOP is `unsubscribed`.
- **What 2.0 keeps byte for byte** is pinned by `tests/unit/golden.test.js` on values of 1.2.1:
  the fingerprint of a message (which reads neither `channel` nor `tenantId`), the JSON, hash,
  HMAC, id, Message-ID and Content-IDs of an email job, the envelope of a sealed one, the ids of
  audit events, the ranks of 1.2 and the keys of `./idempotency`; and by the jobs 1.2.1 wrote in
  `tests/fixtures/queue/`, which are never written again. A test there that fails is a break.
- **One queue:** one core (`job.js`, `parse.js`, `handler.js`, `queue.js`) with a strategy per
  kind of job (`email-job.js`, `channel-job.js`, picked by `strategies.js`); the API has no
  `Mail` (`createQueue`, `createJobHandler`, `prepareJob`, `parseJob`, `QueueError`,
  `JobData`). The email job stays `v: 1` byte for byte, named `mail`. A job of a channel is
  `v: 2`, checked by `createChannelMessage` when enqueued (E.164 by the queue's
  `defaultCountry`), its id seeded `ns\0tenant\0key\0channel`, named by its channel (which
  `channelOfJob` reads of a sealed one), its `channel` sealed with the rest and never in
  `ENVELOPE`, so that a worker of 1.2 releases it as `unsupported_version`; its template
  renders `text` (the subject is a push's title), WhatsApp's template is `providerTemplate`,
  media are URLs, ids, bytes or refs `resolveAttachment` resolves, and a receipt with
  `state: 'sent'` adds the audit state `sent`. The channels take a queue of their own (another
  `queueName`, another collection of the outbox), a rule of the docs, not of the code.

## Roadmap

From the comparison of 14 Node.js email libraries (`docs/comparison.json`, 2026-10-07). The market
is not short of providers or SMTP clients; it is empty in the reliability layer. P0 is required for
a first release, P1 for an advantage over the alternatives, P2 after the first release.

**Phase 0, contracts.** The message and its builder, `Transport`, `QueueDriver`, `AuditSink`, the
model of states and events. `tenantId` is in the context from the start.

**Phase 1, reliable sending (P0).**

- **The transport of its own** (done, ported from upyo 0.7.0; its known bugs are in `BUGS.md`,
  "Code ported from upyo"): the MIME builder; the SMTP client (pool, STARTTLS with `requireTls`,
  not RFC 8689 REQUIRETLS, AUTH PLAIN/LOGIN/XOAUTH2, DSN, PIPELINING); DKIM (RSA-SHA256, Ed25519);
  SES v2 over `fetch` with SigV4; seven more HTTP providers and JMAP. 1.1 added sendmail and ten
  providers.
- **A persistent queue:** the outbox in MongoDB (transactional outbox, no Redis needed) and a
  BullMQ driver (Valkey) for throughput and delays; priorities (auth codes before newsletters).
  (Done in 1.2: `./queue`, `./bullmq` and `./mongodb`, the outbox as a `QueueSource` with its
  audit sink and idempotency store, and the memory queue.)
- **The audit log** of every state, with a keyed HMAC plus an encrypted block for the recipient
  (crypto-shredding), so the right to erasure does not fight an append-only log. 3–6 records per
  message; optional hash chain for tamper evidence. (Partly done in 1.2: `./audit` and the
  MongoDB sink, events with no recipient; the crypto-shredding and the hash chain are next.)
- **Idempotency:** a deterministic key (tenant + purpose + recipient + window) deduplicated in the
  outbox. At least once with deduplication, never a promise of exactly once. A provider without an
  idempotency key (SES) leads to `delivery_unknown` and reconciliation from events, not to a blind
  retry. `./idempotency` (1.1) reserves keys in a store of `reserve`, `complete` and `release`;
  `createMongoIdempotencyStore` (1.2) is that store in MongoDB, and `redelivered:
  'delivery_unknown'` of the worker stops a blind retry where no key is taken.
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
between transactional and bulk mail (tenants in turn and a pause per tenant in 1.2); scheduled
sending as a queue delay (done in 1.2, `scheduledAt`; 1.1 schedules through the providers that
can); a `Renderer` interface with an optional React Email adapter (no template
engine of its own; done in 1.1, `./render`); more providers (done in 1.1).

**The channels (2.0 to 2.2, `PLAN-channels.md`).** From the comparison of 11 Node.js libraries of
SMS, chat apps and push (`docs/comparison-channels.json`, 2026-10-22): the market is not short of
providers or SDKs; it is thin in delivery receipts across channels, fallback on the outcome and a
record of what happened, which is the layer this package has for email.

- **2.0:** the contracts above; the names of observability without `email` (metrics
  `mailer.message.*` with `mailer.channel`, log events `message.*`, audit events
  `message.<state>`); `./webhooks/<provider>`; `./channels` (the builder, phone numbers, segments,
  escaping) and `./router`; the decorators on channel messages, phone numbers redacted with
  addresses; and nineteen providers: SMS (`./twilio`, `./vonage`, `./infobip`, `./sinch`,
  `./aws-sms` on AWS End User Messaging; `./turbosms`, `./alphasms` and `./smsclub` for Ukraine),
  RCS (`./rbm`), `./meta` (WhatsApp, Messenger, Instagram: one Graph client, one window),
  `./telegram`, `./viber`, `./slack`, `./discord`, `./teams`, `./google-chat`, `./fcm`, `./apns`
  and `./webpush`.
- **2.1, a closed loop:** the webhooks of the channels, signature mandatory; one `./suppression`
  for email and the channels, checked before a message is queued, with a bypass for
  transactional messages (one-time codes); the 24-hour window of Meta; `./fallback` between
  channels and email on refusal or `not-on-channel`, never after a send of unknown outcome
  without an idempotency key; rate limits per channel (Telegram about 30 a second and 1 a second
  per chat, Slack about 1 a second per channel, Discord's buckets from `X-RateLimit-*`).
- **2.2:** the stores of suppression and of the window in `./mongodb`; the crypto-shredding of
  recipients in `./audit`, addresses and numbers together; the fallback on no receipt within a
  deadline.
- **The rules of a channel:** E.164 normalization with a default country; the encoding (GSM-7 or
  UCS-2) and the segments of an SMS (160/153, 70/67), counted before it is sent; the WhatsApp
  template, required outside the window; text escaped for the markup of its channel (Slack's
  mrkdwn, Telegram's HTML, Discord's Markdown) and mentions of everyone off unless allowed; the
  size limits of each channel checked before a send rather than learned from a 400.

**Decisions:**

- **The transport is ported from upyo, not a wrapper over Nodemailer.** The comparison advises
  against rewriting SMTP (Nodemailer has 15 years of edge cases). Upyo already has the transport
  this roadmap planned, on the same platform (zero dependencies, `node:net`, `fetch`), so it is
  ported file by file instead of written anew; its known bugs are fixed afterwards (see "Code
  ported from upyo"), and the correctness suite of Phase 1 still applies to it.
- **BullMQ is one driver, not the base:** it ties the queue to Redis/Valkey; the MongoDB outbox
  gives a queue with no new infrastructure.
- **A shared `./webhooks` and an entry per provider (done in 2.0).** 1.1 put its fifteen
  verifiers in one entry (some 15 KB min+gzip), as fifteen more entries were fifteen more parts
  of the API for less than a kilobyte each. With the channels they come to some thirty, which a
  function that verifies one provider would pay for at its cold start, and 2.0 changes import
  paths anyway: `./webhooks` keeps what they share (the modules of `claimDelivery` and of the SNS
  verifier, and in its exports the replay store, `WebhookVerificationError` and the types)
  and each verifier is `./webhooks/<provider>` (`src/webhooks/<provider>/verifier.js`),
  named as its transport, with the names of its functions unchanged.
- **One `./templates` entry, not one per engine.** The nine adapters weigh under a kilobyte
  each, the engines are passed in, and the core (loaders, variants, front matter, cache) is most
  of the entry, as the verifiers of `./webhooks` are of theirs.
- **Templates are named, never pathed, and read through the loader.** No engine reads a file
  itself: includes, partials and layouts go through the renderer's loader, which holds them to
  its root; the one exception, MJML's `mj-include`, is off unless asked for.
- **Thirty-seven providers, then few new ones.** The eight HTTP providers of upyo came with the
  port; 1.1 adds the ten most used of unemail and sently (Postmark, Brevo, Mailjet, MailerSend,
  SparkPost, ZeptoMail, SMTP2GO, Azure Communication Services, Scaleway and Cloudflare); 2.0 adds
  the nineteen of the channels, few per channel. Each provider adds its webhooks and API drift to
  maintain, so another one waits for a user who needs it, and none is released before a live run
  of its e2e suite (see "Release process").
- **The channels in mailer, in a major.** They were planned as `@alexify/messenger`; one package
  shares the queue, the audit, the suppression list and the fallback across email and the other
  channels. 2.0 rather than 1.3: staying additive would have made two families of every name
  (metrics, log and audit events) and two queue APIs, for the sake of semver. What is persisted
  keeps its bytes across the major whatever semver allows: the email job v1, its id, hash and
  MAC, its Message-ID, the ids of audit events and the ranks of states.
- **A subpath per vendor, not per channel:** `./twilio` holds SMS, MMS, WhatsApp and RCS, `./meta`
  WhatsApp, Messenger and Instagram; AWS goes by service (`./aws-sms`, as `./ses`).
- **HTTP APIs, not SDKs; official APIs only.** WhatsApp through the Cloud API or a BSP, never
  through clients that drive WhatsApp Web (Baileys, whatsapp-web.js), which break its terms and
  get numbers banned; Signal (bots only through the unofficial signal-cli) and iMessage (only
  through Apple's certified providers) are out for the same reason.
- **One message, the channel's own payload when needed.** The common fields (text, media,
  buttons) cover a one-time code or an alert on every channel; a rich message of one platform
  (Block Kit, an Adaptive Card, a Discord embed, a WhatsApp template) is passed as that
  platform's payload, typed, rather than squeezed into a model that fits none.

**What the competitors appear to get wrong, to not repeat** (findings from reading their code in
October 2026, not reproduced except for emailjs, which was run against fake SMTP servers): no
dot-stuffing (emailjs); STARTTLS that accepts any certificate, or
falls back to plain text and sends AUTH (emailjs, worker-mailer, unemail without `requireTLS`);
Bcc in the headers of the message (worker-mailer); relaxed body canonicalization of DKIM that drops
every empty line instead of the trailing ones (sently); retrying permanent SMTP 5xx (sently);
inline images in `multipart/mixed` instead of `multipart/related` (Upyo, unemail); options
accepted but never read (Upyo `validateSsl`); no CRLF sanitization and `os.EOL` instead of CRLF
(MIMEText). The Upyo ones came with the port and are in `BUGS.md`, "Code ported from upyo".

**For the channels** (from reading the packages as published on npm in October 2026, not
reproduced; the cells and notes of `docs/comparison-channels.json` name the files): a suppressed
or deduplicated send reported as a success, which stops the fallback to the next channel, and a
queue worker that sends every channel again when one failed (@visulima/notification); a status
parser that maps an unknown event to `delivered` (@visulima/notification), or an accepted SMS
always reported `sent`, never `queued` (@thinwrap/notifications); a channel with no provider that
logs the whole request, recipient included, and reports success (notifme-sdk); message POSTs
retried without an idempotency key (Telnyx unless one is passed, node-telegram-bot-api after a
timeout, grammY's auto-retry without a limit); HTTP retries stacked at three levels, ignoring
`Retry-After`, and one circuit breaker and rate limiter for every channel
(@visulima/notification); webhook signatures compared with `===` (Vonage SMS, Plivo, Sinch), no
window of time (Sinch, Plivo), a JWT checked without the hash of the body (Vonage), a body
re-serialized before its HMAC (Sinch), and a check turned off by `NODE_ENV` (Novu's bridge); a
queue reservation that never expires (@visulima/notification's unstorage queue); and an import
that overwrites the global agents of axios (Plivo).

**Out of scope:** inbound mail, and inbound messages of the channels beyond an opt-out and the
window they open; unofficial clients (WhatsApp Web, signal-cli); quiet hours; the management APIs
of the providers (domains, templates, statistics, sender registration, template approval, buying
numbers), which their dashboards and SDKs cover.

**To check before designing:** whether Fly.io restricts outgoing SMTP (it would make HTTP-first
a requirement). Checked: per-tenant fairness (groups) is a feature of BullMQ Pro only; the type
definitions of BullMQ 6 have no group options.

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
- **The channels (2.0):** APNs goes over `node:http2`, which Bun and Deno implement through their
  Node compatibility, so `tests/runtime` sends to a local HTTP/2 server on all three. The replay
  of Deno's `fetch` above would send an SMS twice from a provider without an idempotency key, so
  the providers of the channels are tested for it on Deno as the email ones are.

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
  A commit per subpath and per fix: a feature that spans subpaths lands as a commit for each, so
  that a review reads one at a time (the 1.2 commit of four subpaths, 88 files, was not).

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
- **The channels (2.0):** a provider of a channel keeps its requests in `http-client.js`, as an
  email one does, and has a place in the delivery matrix of the channels,
  `tests/unit/delivery-channels.test.js`: the scenarios of `delivery.test.js` (an ambiguous answer
  is `deliveryUnknown` without a retry, `Retry-After`, secrets and recipients redacted) with a
  channel message, `delivery.test.js` checking each subpath with an `http-client.js` against one
  matrix or the other. Webhooks are tested against recorded bodies with their real signatures.
  Each provider has a row of `tests/e2e/channels.e2e.test.js`, one table as
  `providers.e2e.test.js`, skipped until its variables are set; its live run gates its release
  (see "Release process").
- **Opt-in suites**, outside the gates: `tests/mailpit/` (`pnpm test:mailpit`, serial, as the
  inbox is shared; `docker compose -f tests/mailpit/docker-compose.yml up -d` and
  `MAILPIT_SMTP_HOST`/`MAILPIT_API_URL`, plus `MAILPIT_SENDMAIL="docker exec -i mailer-mailpit
  /mailpit sendmail"` for the sendmail case) and `tests/e2e/` (`pnpm test:e2e`, each suite skipped
  until its provider's variables are set; Stalwart for JMAP in `tests/e2e/jmap/`; the providers of
  1.1 in one table, `providers.e2e.test.js`, which also checks that refused credentials are a
  non-retryable `auth` failure) and `tests/bullmq/` (`pnpm test:bullmq`, serial;
  `docker compose -f tests/bullmq/docker-compose.yml up -d` and
  `BULLMQ_REDIS_URL=redis://localhost:6390`: duplicates, retries after `Retry-After`, priorities,
  delays, a release on close and a Worker without the strategy, on BullMQ itself).
  `pnpm test:stores` runs `tests/mongodb` and `tests/bullmq` and fails without their variables,
  rather than skipping: it is a step of every release (see "Release process"), as GitHub CI does
  not run the stores. The release skill asks for all of them before a release.
- **The template engines, BullMQ, ioredis and mongodb are devDependencies** for the tests of
  `./templates`, `./bullmq` and `./mongodb` (the real engines, a fake BullMQ in
  `tests/helpers/bullmq/`, a collection in memory in `tests/helpers/mongodb/`, and tsd against
  the real classes); `src/` requires none of them. `tests/mongodb/` (`pnpm test:mongodb`,
  serial; `docker compose -f tests/mongodb/docker-compose.yml up -d --wait` and
  `MONGODB_URL='mongodb://localhost:27027/?replicaSet=rs0'`) runs the outbox, the audit sink and
  the store on a replica set: transactions committed and aborted, workers of several processes,
  leases, concurrent reserves of a key, the change stream, the plan of the next-due query
  (`explain()`), and the contract of a source (`tests/helpers/queue/source-contract.js`), which
  `pnpm test` also runs on the memory queue and a fake collection, whole and under fairness.
- **Platform-dependent tests:** the mock SMTP server takes a client that has gone as no failure:
  a reset (`ECONNRESET`; macOS and Windows send an RST where Linux sends a FIN) and a reply
  written after the client closed (`EPIPE` on Linux, `ECONNABORTED` on Windows), which the 221 to
  `QUIT` can always meet, as `quit()` does not wait for it; macOS reports neither, so only CI
  catches a new one, and Docker (`node:22-bookworm-slim`) reproduces Linux. The JMAP test of a
  401 to a raw message of unknown size, which streams, is `todo` on Node 24 (known upstream bug
  14). `tests/unit/export-parity.test.js` also checks that every d.ts using `AsyncDisposable`
  references `esnext.disposable` itself. Node 22 parses no `await using` (Node 24 does), so no
  file it loads may hold one: a test closes what it opens with `t.after`, and a file with one
  fails whole on Node 22 alone, in CI, never on a Node 24 at hand. A path compared with what the
  loader of `./templates` gives is resolved with `fs.realpathSync.native`, as the plain one keeps
  the short names of Windows (the temporary directory of a runner).
- **`tests/runtime/`** runs the package as a consumer does, by its name, with no mock: every entry
  required and imported by name; SMTP over plain TCP, implicit TLS, STARTTLS and an HTTP CONNECT
  proxy, with DKIM checked by `tests/helpers/mime/verify-dkim.js`; an HTTP provider and
  `fromUrl` on the runtime's own `fetch` (a redirect, a body over 4 MiB, a lost answer); and
  `./sendmail` spawning a shell script (POSIX only). The same files run on Node, Bun and Deno, so
  they use `node:test` and `node:assert` alone, never `t.mock`.
- **Bun and Deno** (`pnpm test:bun`, `pnpm test:deno`) run each file in a fresh global
  (`--parallel`), as `node --test` runs each in a process of its own; in one global, the mocks of
  one file reach the next. Deno keeps mocked timers enabled and mocked methods in place after a
  test (`t.after` resets and restores them, `t.mock.restoreAll()`), a TLS server reads no SNI as `null` on Deno and `undefined` on Bun (`false` on Node), the
  JMAP tests of a lost answer are skipped on Deno, whose `fetch` sends it again, and the import
  by name of `export-parity` spawns the node CLI, which Deno is not.

## Documentation site

VitePress in `docs/`, deployed to Vercel (`vercel.json`) at `mailerat.vercel.app`. It is not
published to npm, and lint/format do not cover it.

- Only `docs/index.md` has frontmatter; links between pages are absolute and extensionless.
- `ignoreDeadLinks` is off, so `pnpm docs:build` failing on a dead link is a feature.
- The nav version label is read from `package.json`.
- **The comparison pages are generated.** `docs/guide/comparison.md` (the email libraries) and
  `docs/guide/comparison-channels.md` (the libraries of SMS, chat apps and push) hold the prose;
  the table between `<!-- comparison:start -->` and `<!-- comparison:end -->` of each is rendered
  by `pnpm docs:comparison` from `docs/comparison.json` and `docs/comparison-channels.json`
  (`legend`, `groups[].rows[]`, `libraries[].cells[rowId] = { mark, text, note? }`). Edit the
  data, never the table; CI fails on a diff of either. The first library of each is
  @alexify/mailer itself (this repository, with 🔜 for the roadmap), which `custom.css` tints in
  the brand teal as the second column and pins beside the features from 768px up; keep its cells
  true to the code when behavior changes, and turn a 🔜 of the channels into ✅ only for what is
  done. The pages take the full width through `.VPDoc:has(.ml-matrix)` in `custom.css`. The
  findings in cells come from reading the code (for the channels, the packages as published on
  npm as of 2026-10-22, moved from messenger) and, except for emailjs, were not reproduced; the
  pages say so, and a bug claim should be reproduced before it is made stronger.
- The brand is a teal "envelope" mark (`#0D6B63`, `#4CC2B5` on dark; a placeholder until a final
  logo): `docs/public/logo-mark*.svg`, `favicon.svg` (follows `prefers-color-scheme`),
  `favicon.png` and `logo.png` (the 1200×630 og:image, rendered from SVG with `rsvg-convert`).
- **The guides of upyo are adapted, not generated:** `docs/messages/` (compose, attachments,
  calendar, MIME) and `docs/transports/` (one page per subpath, plus custom transports), with
  examples in CommonJS on `@alexify/mailer/<subpath>`. `/transports/logger` is new (pino-like
  logger) and `/transports/otel` passes the providers in. The pages of 1.1 are new:
  `/messages/render`, `/guide/webhooks`, a page per provider and decorator, and Bun and Deno in
  getting started. Those of 1.2 are `/guide/queue`, `/guide/outbox`, `/guide/audit`,
  `/messages/templates` and `/transports/bullmq` (a "Reliability" group). One sidebar (`guide`
  in `config.mts`) covers the guide, the messages, the transports and the decorators.
- When behavior changes, update README and the matching docs page together. Keep example outputs in
  the docs true to the code.

## Release process

Manual, as in the sibling repositories: no workflow publishes, and GitHub CI is not changed for
it. The `npm-publish` skill walks through it step by step:

1. Bump `version` in `package.json` and in `src/version.js` (`tests/unit/version.test.js` fails
   while they differ).
2. Turn `## [Unreleased]` in CHANGELOG.md into `## [X.Y.Z] - YYYY-MM-DD` and add its link
   reference.
3. Run the gates no CI runs: `pnpm test:stores` on the compose files of `tests/mongodb` and
   `tests/bullmq`; `pnpm test:bun` and `pnpm test:deno` where they are installed; the bench of the
   outbox (`MONGODB_URL=… node bench/outbox.js`) when the outbox changed; and, as before,
   `pnpm test:mailpit` and the `pnpm test:e2e` suites of the providers that changed.
   **From 2.0 a new provider is released only after a live run** of its `tests/e2e` suite on a
   real account: one without it leaves the exports map, the docs and the CHANGELOG of the
   release, and ships in a later minor once it has run (adding a provider is additive). A run
   that passed is recorded in `tests/e2e/live-runs.json` (`{ "<subpath>": { result: 'pass',
   date, version, commit } }`), and `node scripts/provider-places.js <subpath>` lists where a
   provider to take out is. A source in `LICENSE` that no shipped file names leaves it before the
   release (`attribution.test.js` fails on one).
4. Commit, merge into `main` (a squash merge, as #2 and #3), then tag `vX.Y.Z` on the commit of
   `main`, never on the feature branch.
5. Run `pnpm run release` (`scripts/check-live-runs.js`, which fails while a provider of a
   channel of the exports map has no live run recorded, then `pnpm publish`, gated by
   `prepublishOnly`, which includes the size gate and the tarball check; `publishConfig.access`
   is public).
