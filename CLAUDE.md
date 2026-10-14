# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**mailer** (npm package `@alexify/mailer`) is an email library for Node.js, in the place of
Nodemailer, emailjs or Upyo, made of two parts:

1. **The transport:** its own SMTP client, MIME builder and DKIM signing, and HTTP providers on
   `fetch`, starting with Amazon SES v2.
2. **A reliability layer on top of it,** which none of the fourteen libraries in
   `docs/comparison.json` has: a persistent queue and outbox, an append-only audit log, one model
   of delivery events, suppression, idempotency and failover between providers.

It has zero runtime dependencies and runs on Node.js ≥ 22 only (no browser entry).

**Status: the API is being designed.** `createMailer` is exported as a placeholder that throws
(`src/mailer.js`); its signature in `index.d.ts` is provisional. The package, its tooling, tests and
docs are already wired around that name. The direction is in "Roadmap" below.

It is maintained by Alexis Technologies and set up like the sibling libraries
`@alexify/metaschema` and `@alexify/protoarray` (the scaffold follows protoarray's
"chore: set up the repository as an Alexis library" commit). `origin` is
`Alexis-Technologies/mailer`.

Package manager is **pnpm** (pinned in `packageManager`).

## Commands

```bash
pnpm test                          # node --test tests/unit/*.test.js
node --test tests/unit/mailer.test.js   # a single file
node --test --test-name-pattern="Bundle" tests/unit/*.test.js   # filter by name
pnpm run test:coverage             # c8 over src/, gated at 98 lines/statements, 90 branches, 100 functions
pnpm run test:types                # tsd: tests/types/*.test-d.ts against index.d.ts
pnpm run check:dts                 # tsc --noEmit --strict over index.d.ts on its own
pnpm run lint                      # oxlint src tests scripts bench
pnpm run format                    # oxfmt src tests scripts bench (format:check in CI)
pnpm size [--max-gzip <KB>]        # esbuild bundle size of index.js; CI gates at 4 KB min+gzip
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
- `src/index.js` lists every export **by name** (`module.exports = { createMailer }`), never by
  spreading module objects. cjs-module-lexer only sees named keys, and ESM
  `import { createMailer } from '@alexify/mailer'` depends on it.
- `index.d.ts` is the only source of the public types, written by hand. A public API change touches
  `src/index.js`, `index.d.ts` and a test together. `tests/unit/export-parity.test.js` compares
  runtime exports with the declared value exports and imports every name from ESM.
  `tests/types/index.test-d.ts` (tsd) pins signatures. `check:dts` needs `--target es2022` because
  there is no tsconfig.
- `package.json` has a closed `exports` map (`types` first, then `default`) and a `files`
  allowlist: `index.js`, `index.d.ts`, `src`, README, CHANGELOG, LICENSE and SECURITY.

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

## Repository layout

```
index.js  index.d.ts   root entry shim + hand-written types
src/
  index.js          public barrel (explicit named exports)
  mailer.js         createMailer placeholder
tests/
  unit/*.test.js    node:test suites, one per area
  types/*.test-d.ts tsd assertions
scripts/
  size.js           bundle-size report and budget gate (CI smoke)
  comparison.js     renders docs/comparison.json into docs/guide/comparison.md
bench/              zero-dependency ops/sec harness; baseline.json is a snapshot for --compare
docs/               VitePress site (mailerat.vercel.app), not published
  comparison.json   the feature matrix of 14 alternatives (the data of the comparison page)
.claude/skills/     metaskills v1.0.5 skills (js-conventions, npm-publish adapted)
```

## Architecture

To be written with Phase 0. The contracts it starts from:

- **`Message`** with a typed builder that rejects CRLF in every header field, and the MIME
  rendering of it (`multipart/alternative`, `multipart/mixed`, `multipart/related` for inline
  images, RFC 2047/2231 encoding, SMTPUTF8).
- **`Transport`**: `send(rendered) → { messageId, accepted, rejected }` or a classified error
  (permanent, temporary, ambiguous). SMTP and the HTTP providers implement it.
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

- **The transport of its own:** the MIME builder; the SMTP client (pool, STARTTLS and REQUIRETLS,
  AUTH PLAIN/LOGIN/XOAUTH2, DSN, PIPELINING); DKIM (RSA-SHA256, Ed25519); SES v2 over `fetch` with
  SigV4; one more HTTP provider (Resend or Postmark).
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
without an idempotency key; OpenTelemetry spans and metrics (time in queue, attempts, failure rate
per provider, outbox size); token-bucket rate limits per provider and per tenant (SES quotas).

**Phase 3, multi-tenant (P1–P2).** Provider credentials per tenant (bring your own SES), domains
and DKIM per tenant, quotas; List-Unsubscribe one-click (RFC 8058) and the split between
transactional and bulk mail; scheduled sending as a queue delay; a `Renderer` interface with an
optional React Email adapter (no template engine of its own); more providers.

**Decisions:**

- **The transport is our own, not a wrapper over Nodemailer.** The comparison advises against
  rewriting SMTP (Nodemailer has 15 years of edge cases); the product needs the transport and the
  layers designed together, so the risk is paid for by the correctness suite in Phase 1.
- **BullMQ is one driver, not the base:** it ties the queue to Redis/Valkey; the MongoDB outbox
  gives a queue with no new infrastructure.
- **Few providers, done well.** Each provider adds its webhooks and API drift to maintain.

**What the competitors appear to get wrong, to not repeat** (findings from reading their code in
October 2026, not reproduced except for emailjs, which was run against fake SMTP servers): no
dot-stuffing (emailjs); STARTTLS that accepts any certificate, or
falls back to plain text and sends AUTH (emailjs, worker-mailer, unemail without `requireTLS`);
Bcc in the headers of the message (worker-mailer); relaxed body canonicalization of DKIM that drops
every empty line instead of the trailing ones (sently); retrying permanent SMTP 5xx (sently);
inline images in `multipart/mixed` instead of `multipart/related` (Upyo, unemail); options
accepted but never read (Upyo `validateSsl`); no CRLF sanitization and `os.EOL` instead of CRLF
(MIMEText).

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
  `test('Area: description', …)`; keep that style.
- `pnpm test` passes the glob unquoted (`tests/unit/*.test.js`): the shell expands it on Linux and
  macOS, and Node ≥ 22 expands it itself where cmd.exe does not, so Windows runs every version.
- `tests/unit/bundle.test.js` builds `index.js` with esbuild in memory (minified and not) and calls
  the API through the result, so the shipped files keep working after a consumer's bundler (a
  serverless function, a single-file deploy).
- `tests/unit/dependencies.test.js` guards "Zero dependencies" above.
- `tests/unit/scripts.test.js` runs `scripts/size.js` with a budget it always meets and one it
  never can.
- New behavior needs a test that fails without the change. Network transports will be tested
  against local fake servers (an SMTP server on `node:net`, an HTTP server on `node:http`), never
  against a real provider in `pnpm test`.

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
- When behavior changes, update README and the matching docs page together. Keep example outputs in
  the docs true to the code.

## Release process

Manual, as in the sibling repositories. The `npm-publish` skill walks through it step by step:

1. Bump `version` in `package.json`.
2. Turn `## [Unreleased]` in CHANGELOG.md into `## [X.Y.Z] - YYYY-MM-DD` and add its link
   reference.
3. Commit, then tag `vX.Y.Z`.
4. Run `pnpm run release` (`pnpm publish`, gated by `prepublishOnly`; `publishConfig.access` is
   public).
