# Bugs found and fixed

The ledgers of the bugs of the sources this package was ported from, and of those its reviews
found, each fixed in its own commit with a test that fails without it. `CLAUDE.md` holds the
rules of a port and of a fix; each new fix adds its entry here, under the prefix of its source
or review: 1–89 upyo, N nodemailer, U unemail, S sently, R the review of 1.1, the letters of
the sources of the channels (T, V, NV, TG, TW, VG, SN, AP, FB, DC, SL, VB, BB, EC), and C the
review of 2.0. Commits, tests and docs name an entry by its number or letter (bug 28, C17).

## Code ported from upyo

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
88. otel: the network attributes of a span were guessed from the shape of the wrapped
    transport's config, so a transport of the application with a `host` and a `port` was
    `smtp`, one with a `domain` was given `api.mailgun.net` as its `server.address`, and an
    `endpoint` of any scheme was `http`. SMTP and Mailgun's default URL are told by the
    transport's name (its id), and a URL gives `http` only when it is one.
89. pool: every error a transport threw was recorded and failed over, so a bug such as
    reading a property of `undefined` was hidden in the receipt, and one that struck after
    the message went out sent it again through the next transport. A bug, as `./retry`
    tells it since 65 (`isProgrammerError`, now `internal/programmer-error.js`), rejects
    the send; a fetch failure still fails over.

## Code ported from nodemailer, unemail and sently

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
- R21. gate: the first message of a run was admitted before the wrapped `sendMany()` took it,
  so one that threw or returned at once left it neither failed nor abandoned (a key pending, a
  probe held). Its slot is there from the start, and a message never taken goes to
  `gate.unsent`, which `./idempotency` answers by freeing its key.
- R22. breaker: a `now()` that threw fell back to `Date.now`, another clock, and put a circuit
  some fifty years off; it gives the last time it gave.
- R23. ratelimit: a bucket not yet full was dropped as readily as a full one, silently; any
  number of messages could wait; a message whose tokens were there missed an abort between two
  of a batch; a shared store that gave no `waitMs` was asked every millisecond. Full buckets go
  first and an early drop is told (`MAILER_RATELIMIT_EVICTED`), `maxQueue` bounds the waiters,
  the signal is read before the tokens, a store is asked again after the rate, and
  `ratelimit.waited` tells the wait.
- R24. sendmail: a message that could not be read sent SIGINT alone, which a process could
  ignore for good; it gets SIGKILL after the grace.
- R25. tee: the copies started before the primary's send; they start once it has answered.
- R26. hooks: a copy a `beforeSend` returned skipped the checks of `createMessage`, so a line
  break in a name or an address reached the converters; `checkMessage` of `src/core/message.js`
  runs them again.
- R27. webhooks: SNS certificates were cached by the URL as written, and kept though the
  signature failed, so spellings and forged messages read certificates and pushed the one in use
  out. A certificate URL is taken only as the URL parser writes it, and kept once it verified.
- R28. webhooks: a Scaleway anchor that was no CA, or no longer valid, issued; the chain must
  hold CAs, valid when they are trusted.
- R29. webhooks: SparkPost's classes 25 and 26 (its own refusals), 60, 80 and 100 (no failure)
  and 90 (an unsubscribe) were bounces; a Maileroo failure was hard and a Maileroo or Scaleway
  deferral a soft bounce, though neither provider said so. They follow the rule of the guide.
- R30. webhooks: the verifiers of providers that sign no id took `replayStore` and `leaseMs`
  and never read them; an Azure `validationUrl` with a password passed; the lease was said to
  be shorter than SNS's first retry, which it is not.
- R31. webhooks: `commit` and `release` of the replay store took the id alone, so a request
  whose lease ran out could free the reservation of the next; a delivery reserves under a token
  of its own, and the memory store tells when it drops committed ids early.
- R32. webhooks: the guide found a message of unknown delivery by `rfcMessageId`, which the HTTP
  APIs write themselves; an event carries `correlationId` of the message's metadata.
- R33. a timeout over 2^31 - 1 ms fired at once, and `AbortSignal.timeout` threw past 2^32 - 1;
  `timerMs` of `internal/sleep.js` cuts each to the longest a timer keeps.
- R34. a logger that threw was a warning per record with its text as it was; it is told once
  per log by its name, and `./idempotency` redacts the addresses of a key in its records.
- R35. receipts of the library's own conditions had no category; each names one, or the status
  it is told by, and `tests/unit/internal.test.js` fails on a call that names none.
- R36. api: `classify()` of a provider reached the receipt alone, so a retryable 420 of
  SparkPost was not retried in the send; the shared client passes `isRetryable`.
- R37. verify: a 403 verified the key of every provider; only those whose sending keys are
  refused the read with one (`acceptForbidden`: SES, Mailgun, SparkPost, MailerSend,
  Scaleway), and with no error marked verified to carry it.
- R38. postmark, mailjet: a batch was converted whole, its files in base64, before its first
  request; a request goes as soon as the next message would not fit.
- R39. breaker, tee: `breaker.open` named the change of state and every refused send, and the
  tee wrote the code of its process warning in its records: `breaker.refused`,
  `tee.mirror_failed`.
- R40. jmap: `verify()` retried its reads with no `onRetry`.
- R41. attachments: `inlineDataUrls` read HTML of any length; `maxLength` bounds it.
- R42. tee: the deadline of an awaited mirror was unref'd, as that of a detached one is, so a
  script whose mirror hung on nothing that kept the process alive ended with its send unsettled
  (on Node 22, so did the suite of `./tee`). The caller waits for it, so it keeps the process.

## Code ported for the channels

**Bugs of the sources fixed in the port** (each in the `feat:` commit of its provider, with a
test that fails on the source's behavior):

- T7. thinwrap (`telegram.connector.ts`): every 403 of Telegram was an invalid recipient, so a
  user who blocked the bot and one who never started it looked alike, and alike a typo.
  `./telegram` reads the description: a bot blocked, kicked or no member is `blocked`, one
  never started `not-on-channel`, a deactivated user `invalid-recipient`.
- V11. visulima (`providers/chat/telegram/provider.ts`): an answer of `ok: true` without
  `result.message_id` was a success with an empty id. `./telegram` reports it as
  `deliveryUnknown`, as Telegram took the request.
- TG1. node-telegram-bot-api (`src/core/transport.ts`): `sendMessage` was sent again after a
  timeout, a 5xx and a failure to read a 200, after each of which Telegram may have sent it.
  `./telegram` retries a 429 after its `retry_after` and a connection never made alone; a
  timeout or a 5xx (`isAmbiguousStatus` of the shared client) is `deliveryUnknown`.
- SL1. @slack/web-api (`packages/web-api/src/WebClient.ts`): every request, `chat.postMessage`
  among them, went through `pRetry` after a network failure or a 5xx, so a message Slack had
  posted was posted again. `./slack` treats a lost answer, a 5xx, a `fatal_error` and an
  `internal_error` as `deliveryUnknown` and retries only a 429, a `service_unavailable` and a
  connection never made.
- T8, V10. thinwrap (`discord.connector.ts`) and visulima (`providers/chat/discord/provider.ts`):
  no `allowed_mentions` was sent, so an `@everyone` in a text of a user pinged a whole server.
  `./discord` sends `{ parse: [] }`, with the users and roles of `mentions`, and `@everyone`
  only for `everyone: true`.
- DC1. discord.js (`packages/rest/src/lib/handlers/SequentialHandler.ts`, `utils/utils.ts`): a
  429 was not counted among the attempts, so a route that kept answering it was retried without
  end, and a timeout was retried with no nonce. `./discord` counts a 429 as an attempt, and a
  message of a bot carries a nonce with `enforce_nonce`, so that it is retried as the same
  message; a webhook, which takes none, is `deliveryUnknown` after an ambiguous answer.
- T3. thinwrap (`fcm.connector.ts`, `apns.connector.ts`): without a cache of the
  application's, a token of the service account was made for every send, and so was the JWT of
  APNs, which answers a token changed within 20 minutes `TooManyProviderTokenUpdates`. `./fcm`
  holds one in `internal/google-auth.js`, asked for once however many sends wait, and drops it
  when FCM answers a 401; `./apns` signs one for 55 minutes (`internal/token-cache.js`).
- T5. thinwrap (`fcm.connector.ts`): an error was read by its status alone, so an unregistered
  token and a project not found were both an invalid recipient. `./fcm` reads the `errorCode`
  of the FcmError first (`UNREGISTERED`, and a field violation of `message.token`, are
  `unregistered`).
- T4. thinwrap (`apns.connector.ts`): a token APNs answered `ExpiredProviderToken` was left to
  the application to evict, so every send failed until it did. `./apns` drops it, unless it is
  younger than the 20 minutes between two tokens, and the send is retried with a new one.
- AP1. node-apn (`lib/client.js`, `lib/config.js`): a 500 and a 503 were retried, after which
  APNs may have taken the push, and the environment was production when `NODE_ENV` said so.
  `./apns` makes a 5xx `deliveryUnknown` without a retry, and `environment` is required.
- V15. visulima (`providers/push/apns`): the session had no timeout, no handling of a GOAWAY and
  kept the process alive, and a refusal was its reason as text. `./apns` goes through
  `internal/http2.js` (a deadline per request, a new session after a GOAWAY, unref'd while
  idle), and every reason has its category (`Unregistered` `unregistered`).
- V16. visulima (`providers/push/fcm/provider.ts`): the TTL went to the `android` block alone,
  so an iOS or a web push outlived it. `./fcm` writes `expiresAt` and the priority to
  `android`, `apns` and `webpush`.
- FB1. firebase-admin (`src/utils/api-request.ts`): `messages:send` was retried after
  `ETIMEDOUT`, after which FCM may have taken it. `./fcm` treats a lost answer as
  `deliveryUnknown`, and retries a 429, a 500, a 503 and a connection never made.
- V14. visulima (`providers/push/web-push`): a push had no bound on its size, a bad VAPID key
  threw from `send()`, and a 404 or a 410 of a subscription gone was a failure like any other.
  `./webpush` refuses a push over 3993 bytes before any request, checks the keys when it is
  made, and makes a 404 or 410 `unregistered`.
- EC1. http_ece (`ece.js`): `ECE_KEYLOG=1` printed every key, nonce and secret of an
  encryption. Its key log is not ported, and a test sets it and sees nothing written.
- T9. thinwrap (`ms-teams.connector.ts`): the 202 of a webhook of Workflows was `sent`, though
  the flow posts the card after it answered, and may fail. `./teams` makes it `accepted`.
- V13. visulima (`providers/chat/msteams/provider.ts`): a text went as a MessageCard of the
  Office 365 connectors, which the webhooks of Workflows that replace them do not render.
  `./teams` sends an Adaptive Card in the envelope of an activity, as thinwrap does.
- T10. thinwrap (`whatsapp-business.connector.ts`): a body of `type: 'template'` went without
  its template, for Meta to refuse. `./meta` refuses it before any request; it also gives the
  codes of the channels their categories (131026 `not-on-channel`, 131047 `outside-window`,
  131050 `opted-out`) where thinwrap made them invalid requests or recipients.
- T1. thinwrap (`twilio.connector.ts` and seven more): an SMS the provider took was always
  `sent`, though it was queued. `./twilio` makes it `accepted`, with the `segments` Twilio
  counted, the delivery coming to the status callback.
- T6. thinwrap (`twilio.connector.ts`): 21610, a STOP of the recipient, was an invalid
  recipient, as was a region not enabled (21408). `src/twilio/codes.js` makes it `opted-out`
  and 21408 `configuration`, a table `./webhooks/twilio` will share.
- T11. thinwrap (`base/base.connector.ts`): a request took no signal and no timeout, and an
  abort was an invalid request. `./twilio`, as every transport on the shared client, ends a
  request at its deadline and rejects with the reason of the caller's signal.
- V7. visulima (`providers/utils/http.ts`): a POST was sent again after its timeout, after
  which Twilio may have queued the message. `./twilio` treats a lost answer as
  `deliveryUnknown`.
- V8. visulima (`providers/utils/sms.ts`): the recipients of an SMS were folded into one result,
  so a partial failure read as a success. A message of `./twilio` has one recipient and its
  own receipt.
- T2. thinwrap (`vonage.connector.ts`): only `messages[0]` of an answer was read, so the
  segments were lost and a later part that failed left a success. `./vonage` reads every part:
  its segments are the `message-count`, a refused part fails the message, of unknown delivery
  when an earlier part went.
- VB2. viber-bot (`lib/viber-client.js`): the answer was parsed as JSON, so the
  `message_token`, a 64-bit integer (5741311803571721087), lost its last digits and matched no
  delivery callback. `./viber` reads it from the text of the answer, as a string.
- NV4. Novu (`packages/providers/src/lib/sms/infobip/infobip.provider.ts`): the `messageId` of
  any 200 was a success, though Infobip answers a message it refuses with a 200 and a status of
  the group REJECTED. `./infobip` fails it by the name of the status, as thinwrap does, and the
  groups UNDELIVERABLE and EXPIRED too; thinwrap's DND, an opt-out, and the sender or the
  credits of the account, a configuration, were an invalid recipient and an invalid request.

**Bugs of 2.0 found in review before its release** (each in its own `fix:` commit, with a test
that fails without it; C for the channels):

- C1. smsclub: a refusal in `add_info` was its JSON, keyed by the numbers it refused, and the
  receipt kept the answer as `providerDetails`, so a receipt, a log of it and the audit held a
  number without its `+`, which redaction does not catch. The text is the reasons alone.
- C2. logger, otel, queue: a channel's recipient was redacted as the message wrote it and as a
  number with a `+`, while most SMS providers are sent it without one and echo it so; and the
  reasons and the audit of the queue knew no recipient. `redactMessageRecipient` replaces the
  digits of an E.164 recipient without their `+` too, and the queue redacts with the job's.
- C3. http2: a stream above the last of a GOAWAY was marked unsent by the error Node gave it,
  which Node gives every stream of the session it destroys, so the streams the server took were
  marked too, and retried. A refused stream is marked in an error of its own, the cause Node's.
- C4. api: a request that failed before it was sent was a failure without a response, so of
  unknown delivery: a deadline met while it waited for its token (FCM, RBM, Google Chat, the
  Teams bot), a provider of credentials that threw (AWS SMS), and a header field `Headers`
  refused, whose error printed the value, a credential. `fetchWithAuth` marks what fails
  before the request unsent, a refused header field without its value, and `requestWithRetry`
  keeps the mark on the error of a timeout.
- C5. aws-sms: a provider of credentials was awaited without the signal of the attempt, so one
  that never answered held a send past its timeout and its caller's abort. It is awaited until
  the signal aborts (`untilAborted` of `internal/until-aborted.js`, which the token cache shares).
- C6. config, webhook-url, channels: a base URL, the URL of a webhook or the service URL of
  Teams could carry a user and a password, which `fetch` refuses at the first send with an error
  that prints the URL whole (a bot token in Telegram's path, the secret of a webhook), the text of
  a receipt of unknown delivery. They are refused when made, the URL not shown.
- C7. every transport of a channel: `scheduledAt` was read by none, so a message scheduled
  for tomorrow went at once, reported sent. `sendConverted` refuses it for a message of a
  channel (`unsupported`), as an email transport that cannot schedule does; the queue delays it.
- C8. core: the client reference generated for a message of a channel was kept with the
  message, so a second `send()` of it carried the first one's: `./idempotency` answered it with
  the first receipt, sending nothing, and RBM or Discord took it for the first. `pinMessageId`
  gives a channel's message a new reference at each call, one per send.
- C9. router: a route whose `sendMany` ended without reading its batch was given the same
  message again, without end, in microtasks that starved the event loop. A message no route took
  fails as `unsupported`, and the next is read.
- C10. router: `verify()` called each transport's unwrapped, so one that threw before it
  returned a promise rejected the router with that error alone and left the others unverified,
  as bug 66 of the pool's dispose. Each goes through `verifyWrapped`.
- C11. http2: a response of a status of 600 to 999, which HTTP/2 carries, made `new Response`
  throw a `RangeError` in the listener of the response, which nothing caught: the process ended.
  Such a status fails the request, of unknown delivery, as the server had it.
- C12. http2: Node fails a stream before it has an id when its session ran out of ids, after
  2^30 requests, and keeps the session open, which stayed in use: every later push failed as of
  unknown delivery, though none was sent. A stream without an id is unsent, and a session out of
  ids is retired.
- C13. http2: a ping made while the session connected, which Node cancels, destroyed the
  session, failing the pushes that waited on it (`pingIntervalMs` shorter than a slow
  handshake). No ping goes while it connects, and a cancelled one ends nothing.
- C14. turbosms: 500 FAILED_CONVERT_RESULT2JSON (and 501), a request that ran and an answer
  that could not be written, was a retryable failure, which a queue sent again under a new
  `sequence_id`, so twice. The answer is asked again under the same `sequence_id`, which gives
  the results of the first, and of unknown delivery when it never comes; 502, a body TurboSMS
  could not parse, is `validation`.
- C15. turbosms: 427 NOT_ALLOWED_MESSAGE_DUPLICATE, the same message created within 90
  seconds, which went then, was a permanent `validation` refusal of a message sent. It is of
  unknown delivery.
- C16. smsclub: 453, the same SMS within two minutes, the first of which went, was a definite
  `rejected`, even after a 5xx retried within one send. It is of unknown delivery, not retried.
- C17. meta: a 5xx of the Graph API (code 1, 2 or 131000) was retried as a message Meta did
  not take, though it may have, and no key dedupes a message: it went twice. A 5xx is of
  unknown delivery, never retried, as for the other APIs of chats.
- C18. apns, rbm, google-chat, turbosms: the `generateId` of the transport was called with no
  kind and its value sent unchecked as an `apns-id`, a `messageId` of RBM, a `requestId` or a
  `sequence_id`, of which APNs and RBM want a UUID and TurboSMS 40 characters at most: a
  generator of ULIDs failed every send without a key. The id goes through `generateId` of the
  core, by its kind, and `toUuid`.
- C19. google-chat: the `to` of a message of the app went into the path as written, so a `#`
  or a `?` moved the `requestId` out of the query (a send retried as if keyed, twice), and `../`
  aimed the token of the app at other methods. A recipient is `spaces/` and an id alone.
- C20. google-chat: a 5xx of the app, after which the message may have been posted, ended as a
  retryable failure, which a caller sent again under a new `requestId`. It is ambiguous:
  retried under the same `requestId`, its last failure of unknown delivery, as Discord's bot.
- C21. slack, discord, teams, google-chat: a message the transport lacked the credential for
  (a webhook, a bot, a service URL of Teams not allowed) was refused as `validation`, at which
  `./pool` stops, so a transport after it that had it was never tried. It is `unsupported`, a
  refusal by this transport's limits (R10).
- C22. twilio: 21612, a message the pair of To and From cannot carry (a sender, a country or a
  carrier), was `unreachable`, retried in the send and again by the queue. It is
  `configuration`.
- C23. vonage: a part of status 0 without a `message-id` was taken for a failed part and
  classified by the status 0, a `validation` refusal of an SMS Vonage sent. It is sent, of no
  id: the receipt is of unknown delivery.
- C24. vonage: a correlation id of 41 to 100 characters, which the SMS API takes as its
  `client-ref`, was left out, so no delivery receipt found its message; and a `callback` over the
  100 characters of the API was taken. Both bounds are those of the API.
- C25. vonage, infobip, turbosms: a refusal kept the answer as `providerDetails`, whose parts,
  message or results name the number without its `+`, in every receipt and the receipts of
  `./pool`. The details are the status or the code of the refusal alone.
- C26. aws-sms: `Context` was built of any metadata, while AWS takes a key of 1 to 100
  characters and a value of 1 to 1000 that neither starts nor ends with a space, so an empty
  value or a longer one failed the SMS. An entry AWS would refuse is left out of the context.
- C27. aws-sms: `verify()` failed for a key that may only send, which the API refuses the read
  of `DescribeConfigurationSets` with an `AccessDeniedException` in a 400, as R37 has it for
  SES. Such a refusal verifies the key.
- C28. turbosms: an SMS was bounded by ten parts, 1530 characters of GSM-7 and 670 of UCS-2,
  past the 1521 and 661 TurboSMS documents and refuses; the bound is its own.
- C29. alphasms: a text of Viber with a link button and no picture, `viber_type: 'text+link'`
  of AlphaSMS's documentation, was refused before the request. It is sent as that type.
- C30. fcm: a push of data alone of priority `high` had `apns-priority` 10, which FCM allows
  no payload of data alone to iOS (only 5). It has 5 on iOS, high elsewhere.
- C31. webpush: a `p256dh` of 65 bytes from `0x04` that is no point of P-256 failed as
  `unknown` when ECDH refused it, so the subscription was kept. It is `invalid-recipient`.
- C32. meta: the text of Instagram was held to the 2000 characters of Messenger, past the 1000
  bytes of UTF-8 Instagram takes; it is held to those.
- C33. teams: the scope of the token of a bot was the public one whatever its `tokenUrl`, so a
  bot of GCC High or DoD, whose service URLs the transport allows, never authenticated. A
  `tokenUrl` of `.us` asks for `api.botframework.us`, and `scope` sets another.
- C34. channels (`normalizePhone`): a trunk 0 written after the calling code was kept
  (`+44 07911…`, `+380 067…`); the 8 of a Russian number of its own (`812`, `800`) was taken for
  the trunk; the digits of an international number without its `+` (`380671234567` in Ukraine)
  got the code again; `0011` (Australia) and `810` (Russia, Kazakhstan, Belarus) were read as
  national digits; and +247 was no code. Each gives the number, or none, as E.164 has it.
- C35. channels: a message whose text, title, media, payload or data was empty passed the check
  of a message with nothing to send, and TurboSMS and SMS Club sent an empty SMS; a job of a
  channel was accepted though its worker refused it. Only a field that says something counts.
- C36. channels (`internal/json.js`): a key `__proto__` of a payload, which `JSON.parse`
  makes an own key, was assigned to the copy, setting its prototype, so a direct send carried
  its fields and a queued one, after its JSON round trip, did not. It is refused.
- C37. channels (`escapeDiscordMarkdown`): the dot after a number that begins a line was left,
  so a text such as `1. a` became an ordered list in Discord; it is escaped too.
- C38. verify: a refusal a provider answers in a 2xx (Viber, TurboSMS, AlphaSMS), which the
  check throws, was retried as a read, four requests over seconds, its `statusCode` the code of
  the provider. It is thrown at once (`isAnswer`), its HTTP status kept and the provider's code
  apart.
- C39. public-url: the check of a URL of an attachment or a Web Push let SIIT
  (`::ffff:0:0:0/96`) and Teredo (`2001::/32`), which embed an IPv4 address, the discard prefix
  `100::/64` and the documentation ranges `2001:db8::/32` and `3fff::/20` through. They are
  refused.
- C40. token-cache: in the five minutes before a token ended, every call waited for the
  refresh and failed with it, though the token held still served, so a token endpoint down for a
  moment failed every send. Near its end a token is made apart, the held one serving until it
  ends and kept when the refresh fails, tried again after 30 seconds.
- C41. otel: a batch span had no message, so the errors it kept were redacted of addresses and
  numbers with a `+` alone, where the span of a send redacts the recipient of its message (a
  chat id, a token): each kept error is redacted of the recipient of the message it answers.
- C42. queue (since 1.2): what a codec opened was copied by assignment, so a key `__proto__`
  of the sealed fields, which `JSON.parse` makes an own key, became the prototype of the job:
  fields such as `bcc` or `buttons` that its hash and MAC, which read its own keys, left out,
  and its build read, from a writer who could seal but not sign. The key is refused,
  `parseJob` refuses data that inherits fields, and the canonical JSON keeps such a key as a
  key.
- C43. queue: under `signingKeys`, the version and the fields of a job were read before its
  signature, so an unsigned job that claimed a later version, or a channel or a field this
  worker does not know, was given back as `unsupported_version` every five minutes for a week,
  a warning each time, instead of failing as `signature_invalid`. The signature is verified
  first, as it reads no field by its schema; the fields it leaves out (`UNHASHED`) are fixed,
  so that a job of a later version still verifies and waits for its worker.
- C44. twilio, sinch, infobip, vonage, aws-sms, alphasms, viber: a 500, a 502 and a 503 were
  retried, as for an email provider (bug 39), though an SMS API may answer a 500 once it took
  the SMS and none of these dedupes a request, so an SMS went twice, and up to twenty times
  under the attempts of a queue. A 500 and a 502 are of unknown delivery, not retried; a 503,
  which took nothing, is. Viber, an API of chats, makes every 5xx of unknown delivery, as C17
  has it for Meta. FCM and Web Push keep retrying 5xx (FB1), and SMS Club too, its 453 telling
  a second SMS within two minutes (C16).
- C45. http2: Node's `ping` has no deadline and its `false` (too many pings unanswered) was
  ignored, so a connection that died without a word (a NAT that forgot it) kept its session in
  use, every push on it timing out of unknown delivery until the system gave the socket up,
  minutes later. An unanswered ping ends the session after `pingTimeoutMs` (10 seconds), one
  ping at a time, and a request unanswered at its deadline pings at once; GOAWAYs, failed and
  unanswered pings and retired sessions go to the logger of the transport.
- C46. http2: an abort before the answer rejected with the bare reason of the signal, though
  a stream without an id never had its headers sent, so a deadline met while the session
  connected (a slow TLS handshake) made a push of unknown delivery, never retried, that never
  went. Such an abort is an error of its own, marked unsent, the reason its cause.
- C47. every transport of email: a message of a channel, given through a queue shared with
  the channels or a router or a pool set up wrong, failed with the TypeError of a field it has
  not (`reading 'name'`), of the category `unknown`, and Resend's `sendMany` threw for the
  whole batch. It is refused before any request as `unsupported`, as a transport of a channel
  refuses an email (`checkEmailMessage` of `internal/email-only.js`, in every converter and in
  SMTP, JMAP and sendmail), in its place in a batch.
- C48. discord, teams: a recipient went into the path through `encodeURIComponent`, which
  leaves `.` and `..`, so `to: '..'` sent the message, with the token of the bot, to
  `/api/v10/messages`, as C19 had it for Google Chat. A channel or a thread of Discord is its
  snowflake, of decimal digits, and a conversation of Teams is no dot segment.
- C49. idempotency: the key of a message of a channel read no tenant, as an email's does
  for the keys 1.2 stored, so two tenants that sent the same code to the same number under one
  key shared a receipt, and the SMS of the second never went. The store key of a message of a
  channel ends with its tenant after a NUL, which neither a key nor a tenant holds; an email's
  and one a `key` of the application gives are as they were.
- C50. queue: a job of a channel past its `expiresAt`, or whose retry would come after it, was
  told `failed` to the audit, as an email job is, while an SMS a carrier gave up is `expired`.
  A job of a channel is told `expired`; an email job keeps the `failed` of 1.2.
- C51. queue: the `messageHash` of the event `rendered` was an unsalted SHA-256 of what a
  message says, its recipient and text among it, so a code of six digits sent to a number one
  knows came back from the audit in a million guesses. That of a message of a channel is an
  HMAC under a key derived from the first signing key, and absent without one; an email's is
  the SHA-256 of 1.2. The `hash` of a job, in clear beside a sealed one, is the same kind of
  oracle when its other fields can be guessed; it tells duplicates and is checked by workers,
  so it is left for a change of its own.
- C52. channels, token-cache: a failure that names its category before any answer (a token of
  Google or Microsoft refused) made a receipt without `deliveryUnknown`, so a keyed send whose
  earlier attempt was ambiguous (a 5xx of a Chat app) ended as a definite `auth` failure; and
  the cache gave every caller waiting the one error, so the mark one request put on it was
  read by another, never sent. `channelFailure` keeps the mark, its reason and the attempts,
  and each caller fails with an error of its own, of the same class and fields.
- C53. token-cache: a token that could not be made anew while the held one served was told to
  no one, so the first sign of a token endpoint that refused (a key revoked) was every send
  failing once the held token ended. It is a process warning, `MAILER_TOKEN_REFRESH_FAILED`,
  held to ten a minute.
- C54. channels: a message past its `expiresAt` was sent, by the eight transports that read
  none (Telegram, Slack, Discord, Teams, Google Chat, Viber, Meta, SMS Club) and with a time to
  live already over by the others, so a code of sign-in held in a queue past its end still
  went. `sendConverted` refuses it, by the clock of the transport, as a `validation` failure.
- C55. fcm: a push whose notification and data were over the 4096 bytes FCM takes was sent,
  for FCM to refuse with a 400 of `MessageTooBig`. It is refused before any request. Infobip,
  AlphaSMS and SMS Club document no limit of the text of an SMS, so none is guessed; their
  live runs are to find it.
- C56. channels (residual of C25): the error of an answer the shared client read kept its JSON
  whole as `providerDetails`, and the answers of the APIs of phone numbers name the number they
  refused (Twilio's 21211, the `Message` of AWS) without its `+`, which redaction finds in a
  text but not in an object a receipt keeps. A receipt of SMS, RCS or WhatsApp keeps the status
  and code of an error, not the answer.
- C57. logger, otel, queue: the id a provider gives a message of a channel may name its
  recipient (Telegram's `<chat>:<message>`, a space of Google Chat), and it was written whole
  to the record of a send, even without `recordMessage`, to `mailer.message.id` of a span,
  whatever `recordSensitiveData` said, and to the log `queue.job.completed`, which C41 has
  redact the chat id everywhere else. Each is redacted of the recipient of its message; the
  audit keeps it, by which the events of the provider find their message.
- C58. canonical-json (perf): the canonical text of a job went into the digest one token at a
  time, a call of node:crypto for each, and a payload of blocks holds thousands: a job of
  2,000 blocks of Slack hashed at 450 a second, four or five times per job, on the event
  loop. The text goes by pieces of 64 KiB, a long string apart: 825 a second, the same bytes.
- C59. queue: `fail()` redacted the reason it told the audit and the log of addresses and
  numbers with a `+` alone, while a reason of a receipt is redacted of the recipient as the
  job names it, so an error a transport threw (of unknown delivery, a bug, a resolver, a
  `checkJob`) that named a chat id or a number without its `+` was told raw. It is redacted
  by the job, as the others.
- C60. queue: the logs of a job named no channel but at `debug`, so a shared queue's records of
  retries, failures and releases did not say which channel failed, and the `segments` of a
  receipt reached neither the log nor the audit, so the cost of SMS per tenant could not be
  rebuilt. `queue.job.completed`, `retrying`, `failed` and `released` carry `channel`, the
  first the `state` of the receipt, and `accepted` its `segments`.
- C61. otel: `mailer.error.code` and `mailer.job.code` took the code of an answer as it came,
  a string of the provider's, so one that wrote text there made a series per answer. A code is
  kept when it looks like one (64 characters of letters, digits and `_.:-`), and is `other`
  otherwise.
- C62. google-auth, teams: a refusal of the endpoint of tokens put its whole answer, up to the
  64 KiB read, into the message of its error, which a receipt, a log and a warning carry, and
  an `error` of an object read `[object Object]`. The two near copies are one
  (`internal/token-failure.js`), the reason bounded to 300 characters, an object written as
  JSON.
- C63. http: the log of a retry was redacted of addresses and of numbers with a `+` alone, and
  the answers of the APIs of SMS name the number without it (C2), which the logger of the
  transport wrote at `debug`. The request layer knows no message, so it also redacts a bare
  number of 7 to 15 digits there; `onRetry` is given the error as it is.
- C64. webpush: the check that the endpoint resolves to a public address ran in the converter,
  outside the deadline of the request, and `dns.lookup` takes no signal, so a resolver that
  never answered held a send past its timeout and its caller's abort. The check ends with the
  caller's signal and the timeout of the transport.
- C65. token-cache: with no token held, a refusal of credentials, which no retry mends, was
  asked again by the next call at once, each send a request to the endpoint; and a token that
  lived no longer than the five minutes before its end it is made anew in was made anew at
  every call. A refusal that says it is not retryable is given to the calls of the 30 seconds
  after it, unasked, and a short token is made anew from the middle of its life.
- C66. fcm, rbm, google-chat, teams: a token a 401 refused was dropped, so that the next send
  asked for another, but the send that met the 401 failed as `auth`, so a token revoked or
  rotated cost a push or a message; only APNs sent again with a new one. A provider whose
  token a 401 drops (`refreshesToken` of the shared client) sends its first 401 once more,
  with a new token; a second is the credentials' own and fails.
- C67. sigv4: the query of a URL went after the path of the canonical request and its
  canonical query was empty, against the specification, so a signed request with a query
  would be refused; none of SES or AWS SMS has one yet. The query is its own line, its
  parameters encoded as RFC 3986 and sorted, as the vector `get-vanilla-query-order-key-case`
  of AWS's test suite expects.
- C68. webpush: a VAPID private key had to decode to 32 bytes, and `getPrivateKey()` of Node's
  own `createECDH` writes the scalar without its leading zero bytes, so one key of some 300 it
  makes was refused (the delivery matrix, which makes one per run, failed so now and then). A
  shorter scalar is padded back to the 32 bytes its JWK takes; one longer is refused.
- C69. rbm, teams: neither had `verify()`, so `./pool` and `./router` verified them as nothing,
  though their credentials can be checked without a message: each asks for its token, which
  Google makes only for a key it takes and Microsoft only for the secret of the app. A webhook
  of Teams alone verifies nothing, as Slack's and Google Chat's; Web Push and APNs, whose
  credentials no service answers for without a push, have none.
- C70. mongodb (since 1.2): a pause of the queue or of a tenant was a document with no
  `expireAt`, though the collection has its index of expiry, so the pauses of every tenant ever
  paused stayed, and every worker read them all at every interval. A pause expires an hour
  after its end, and only those in force are read.
- C71. mongodb: an outbox the channels share told its depth and its failures as one, so the
  backlog of one channel could not be seen. `stats({ name })` and `failed({ name })` give those
  of one name, the channel of a job of a channel, under an index of `state` and `name`.
- C72. http2, apns: every push of an origin went on one session, bounded by the streams APNs
  takes on it, where node-apn had a client of several connections. `maxSessions` (1 by
  default, at most 64) opens another session while every one has a push out, and a push goes
  on the one with the fewest out.
- C73. channels (perf): `countSegments` read a text twice, once to tell GSM-7 and once to
  count, against the rule of one pass, and `redactMessageRecipient` made the pattern of a
  number without its `+` anew for each record, span and reason. The segments are counted in
  one pass, both encodings at once (10 parts of GSM-7 137,000 a second, was 84,000; Cyrillic
  1,130,000, was 883,000), and the pattern of a number is kept, 256 at most (5.9 million a
  second, was 3.4).
- C74. google-auth, teams: the request of a token took its own deadline, not the transport's,
  Google's refusing a timeout of 0 and the bot's reading one as 30 seconds, where every request
  of a transport takes 0 and Infinity as none (bug 28), and FCM, RBM and a Chat app passed it
  none of theirs. Both are bounded by the timeout of the transport, `tokenSignalOf` of
  `internal/token-failure.js`, 0 and Infinity none.
