# Changelog

All notable changes to **`@alexify/mailer`** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- **Failures are classified more precisely:** a message a provider's limits refuse before any
  request is a non-retryable `validation` failure, where it was `unknown`; and a TLS certificate
  refused in the handshake is a non-retryable `configuration` failure at the first attempt, where
  SMTP reported it as `unknown` and the HTTP transports retried it and reported a retryable
  `network` failure (`deliveryUnknown` on Deno).
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
  returns in its events. A transport that cannot schedule refuses the message with a
  `validation` receipt rather than sending it at once. Resend, SendGrid, Mailgun, Maileroo,
  Brevo, MailerSend, SparkPost and SMTP2GO schedule; ten providers take `tracking`, seventeen
  `metadata` (each page says how).
- **`./attachments`:** `fromPath`, `fromUrl`, `fromDataUri`, `fromStream` and `inlineDataUrls`,
  for what nodemailer read through `path`, `href` and data URIs. Nothing is read implicitly:
  `fromUrl` goes through an injected `fetch`, checks each redirect with `allowUrl` (by default the
  host as written: no `localhost`, and no IP literal of a loopback, private, link-local,
  multicast, reserved or documentation range, NAT64 and 6to4 included, as written or as a name
  resolves), refuses a redirect from https to http, and bounds time and bytes; `fromPath` can be
  held to a `root` by real path and to `maxBytes`, and reads the file it checked.
- **`./render`:** `renderContent(renderer, input)` for the content of `createMessage`,
  `createReactEmailRenderer({ render })` with the `render` of `@react-email/render` passed in, and
  `htmlToText`, linear in the length of its input.
- **`./smtp` connects through what you give it:** `connect` opens each connection (a proxy, a
  tunnel, a socket of another module) with implicit TLS or STARTTLS over it;
  `createHttpProxyConnector` makes one for an HTTP or HTTPS proxy; `localAddress` picks the address
  to connect from.
- **`./sendmail`:** the sendmail command of the system (Postfix, Exim, msmtp), one process per
  message, composed by `./mime` with DKIM; `sendRaw` and `verify`. Only an exit with 0 succeeds, a
  signal after the whole message is `deliveryUnknown`, and the sysexits codes are classified.
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
  message.
- **`./breaker`:** a circuit breaker that opens after `failureThreshold` failures of the
  provider, answers with a retryable `service-unavailable` receipt while open (which `./pool`
  fails over with), and lets exactly one probe through after `resetTimeoutMs`.
- **`./ratelimit`:** a token bucket per `key`, waiting first in, first out, or refusing with a
  retryable `rate-limit` receipt; an aborted send leaves the queue, and a cost over `burst` is
  refused.
- **`./idempotency`:** a key reserved in a store before the send, so a repeat is answered with
  the first receipt, a send in flight as of unknown delivery, and the same key for another
  message refused. `createMemoryIdempotencyStore` is the in-process store; a shared one implements
  `reserve`, `complete` and `release`.
- **`./hooks`:** `beforeSend` may replace or refuse a message, `afterSend`, `onRetry` and
  `onError` hear each send, with a context made for each.
- **`./tee`:** mirrors each message to other transports, each with a timeout of its own and not
  awaited by default, the primary's receipt the one returned.
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
  `release`, or `null`), and a refusal carries the `status` to answer the provider with.
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
  `[A-Za-z0-9_.-]`, its value to a string without control characters.
- **A DKIM signing domain or selector with a tab, CR or LF is refused** before it reaches the
  host parser, which removed them and let the name, line break and all, into the
  `DKIM-Signature` field (the fix of 1.0 missed it).
- **The webhooks of a provider are verified before they are read,** where sently parsed SES,
  SendGrid, Postmark and Brevo events unverified and checked Resend and Mailgun with no window
  of time or replay check.

### Fixed

- **A TLS certificate refused in the handshake was misclassified everywhere:** `unknown` in an
  SMTP receipt, a retried and retryable `network` failure on the HTTP transports (their receipts
  read the words `fetch failed`), and `deliveryUnknown` on Deno, whose `fetch` gives it no code;
  `classifyReceiptError` also missed `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, what Node and Bun report
  for an untrusted CA. It is now a non-retryable `configuration` failure at the first attempt, on
  every transport and runtime.
- **A message refused by a provider's limits before any request was `unknown`;** it is a
  non-retryable `validation` failure.
- **A pooled SMTP connection was reused for any number of messages,** while servers limit the
  messages of one connection (`maxMessages`, above).

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

[unreleased]: https://github.com/Alexis-Technologies/mailer/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Alexis-Technologies/mailer/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Alexis-Technologies/mailer/releases/tag/v1.0.0
