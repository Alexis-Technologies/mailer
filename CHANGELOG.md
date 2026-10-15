# Changelog

All notable changes to **`@alexify/mailer`** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The transport layer, ported from [upyo](https://github.com/dahlia/upyo) 0.7.0 (MIT, © 2025
Hong Minhee): the code is upstream's, converted to CommonJS with hand-written types and no
runtime dependency, one subpath per upstream package. Upstream's known bugs are kept for now and
listed in CLAUDE.md, to be fixed one by one.

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
  libraries generated from `docs/comparison.json`.

### Security

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

- **`./smtp` reads every well-formed reply** (upstream bugs): a final line that is the code alone
  (`250`), which RFC 5321 allows, no longer leaves the client waiting for the socket timeout, at
  any step or after DATA; the greeting waits for a complete line; and a UTF-8 character split
  across two chunks of a reply stays whole.

[unreleased]: https://github.com/Alexis-Technologies/mailer/commits/main
