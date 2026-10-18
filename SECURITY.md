# Security Policy

## Supported versions

Only the latest published version receives fixes.

| Version | Supported |
|---|---|
| 1.x | ✅ |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through
[GitHub's private vulnerability reporting](https://github.com/Alexis-Technologies/mailer/security/advisories/new),
or by email to <dolid.sasha@gmail.com>.

Include, as far as you can:

- what an attacker can do, and what they need in order to do it;
- the affected version, and the runtime (Node.js, Bun or Deno) and its version;
- the transport or provider involved (SMTP server, Amazon SES, another HTTP provider);
- a minimal reproduction.

You can expect an acknowledgement within a few days, and an assessment of severity and a fix
timeline once the report is confirmed.

## Threat model

The transport layer, the delivery events and their webhooks, the queue with its drivers,
templates and the audit of states are built; suppression and the crypto-shredding of the audit
are next. The principles all of it is designed around:

- **Message content is untrusted data.** Addresses, display names, subjects, headers, file names
  and bodies can come from users. A CR or LF in any header field is rejected rather than encoded
  through, so no input can add a header or a recipient, and the body is dot-stuffed so that no
  line can end the SMTP `DATA` early.
- **The SMTP channel is secure by default.** TLS certificates are verified. AUTH is never sent
  over a plain connection: when TLS is required and the server does not offer STARTTLS, or the
  upgrade fails, the send fails instead of falling back to plain text. Bcc recipients never appear
  in the headers of the message.
- **Provider requests stay with their provider.** Redirects are not followed, so credentials in a
  header never reach another host; a provider URL must be HTTPS (plain HTTP only to a loopback
  host); and an answer is read up to 4 MiB.
- **Attachments do not read the machine by default.** No file or URL is read for an attachment
  but through `fromPath` and `fromUrl` of `./attachments`, which the application calls.
  `fromUrl` checks every URL, redirects included, with `allowUrl`; it refuses a redirect from
  https to http, sends its headers to the first origin only and bounds time and bytes. `fromPath`
  with a `root` compares real paths, so a symbolic link cannot lead out of it.
- **The default check of `fromUrl` refuses local addresses, written or resolved, but not DNS
  rebinding.** It refuses `localhost`, `*.localhost` and an address in a loopback, private,
  link-local (the cloud metadata address among them), carrier-grade NAT, multicast, reserved,
  documentation or benchmarking range, and in the IPv6 forms that carry an IPv4 address
  (IPv4-compatible `::/96`, NAT64 `64:ff9b::/96` and `64:ff9b:1::/48`, 6to4 `2002::/16`): an IP
  literal as written (`isPublicUrl`), and every address a host name resolves to. A name that
  answers the fetch with another address than it gave the check (DNS rebinding) passes: an
  application that fetches URLs its users give passes a `fetch` that checks the address it
  connects to. An `allowUrl` of the application replaces the check, resolution included.
- **The sendmail command gets arguments, not a shell line.** The recipients follow `--`, none may
  start with `-`, and Bcc recipients go on the command line, never into the message.
- **Credentials and personal data stay out of logs.** A transport shows `[REDACTED]` in place of
  its SMTP password, OAuth2 tokens, provider key and DKIM private key when it is inspected,
  logged or serialized. `./otel` and `./logger` record addresses only when told to
  (`recordSensitiveData`, `recordMessage`); otherwise the addresses that error text names, such
  as the recipient of an SMTP rejection, are redacted. A receipt returned to the application
  keeps its full error text: logging it is the application's to scrub.
- **Webhooks are verified before they are read.** A delivery event is read only from a request
  whose signature verifies, or, where the provider signs nothing, whose Basic credentials or token
  match, compared in constant time; within a window of time where a time is signed, and once by
  its id. An SNS message (SES, Scaleway) is taken only from a listed topic, signed with the
  certificate of an SNS host or of the trust chain the application pins.
- **A job of the queue is untrusted when it is read.** Whoever can write to its store (Redis,
  MongoDB) could have written it, so the worker checks its shape and its hash before it acts on
  it, and `checkJob` can refuse a sender. The hash, a SHA-256, tells a job that changed but not
  one that was forged, since a writer can recompute it: with `signingKeys`, each job carries an
  HMAC-SHA256 under the application's key, and the worker sends no job that one of its keys did
  not sign. A job names no file or URL: an attachment is its bytes
  or a reference that the application's `resolveAttachment` reads. A job's data is stored as it is,
  a token of a reset link among it, unless a `codec` of the application's seals it (an envelope
  encryption: the store then holds the version, the hash and the signature in clear and the
  rest encrypted); once a job is done with, every driver drops its message (`retainData`, the
  failed jobs' kept for a retry by hand), so a reset link does not wait in the store and its
  backups. The id of a job is a hash of its key, which goes into the audit and the logs: a key
  names what the message tells of, never an address or a secret, and `idSecret` derives the id
  with an HMAC so that it cannot be traced back. The store is the application's to restrict
  (Redis ACLs and TLS, MongoDB roles).
- **Templates are named, never pathed.** A template, include, partial or layout is read only
  through the loader of the renderer, by a name with no `..` or leading `/`; the file loader
  compares real paths, so a symbolic link cannot lead out of its directory. No engine reads a file
  itself, MJML's `mj-include` is off unless asked for, output is escaped by default (Liquid
  included), and the CSS inliner fetches no remote stylesheet. Templates are code: EJS, Eta, Pug
  and Nunjucks run JavaScript, so templates that tenants write belong to Liquid, Handlebars or
  Mustache.
- **The audit holds no recipient.** An event names its message by `correlationId`, with the
  hashes of its job and message; the text of an error in it has its addresses redacted.
- **The audit log can forget a person** (planned). Recipients are stored as a keyed hash and an
  encrypted block whose key can be destroyed, so a request to erase someone's data does not require
  editing an append-only log.
- **Drivers are the application's.** A queue or database driver passed in (BullMQ, MongoDB) is
  trusted the same as any other module the application `require`s; its connection security is the
  application's to configure.
