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
- the affected version and Node.js version;
- the transport or provider involved (SMTP server, Amazon SES, another HTTP provider);
- a minimal reproduction.

You can expect an acknowledgement within a few days, and an assessment of severity and a fix
timeline once the report is confirmed.

## Threat model

The transport layer is built and the reliability layer is being designed; this section will be
completed with it. The principles both are designed around:

- **Message content is untrusted data.** Addresses, display names, subjects, headers, file names
  and bodies can come from users. A CR or LF in any header field is rejected rather than encoded
  through, so no input can add a header or a recipient, and the body is dot-stuffed so that no
  line can end the SMTP `DATA` early.
- **The SMTP channel is secure by default.** TLS certificates are verified. AUTH is never sent
  over a plain connection: when TLS is required and the server does not offer STARTTLS, or the
  upgrade fails, the send fails instead of falling back to plain text. Bcc recipients never appear
  in the headers of the message.
- **Attachments do not read the machine by default** (planned). Reading a file path or fetching a
  URL for an attachment is off unless the application turns it on; fetching a URL is limited in size
  and refuses private and link-local addresses.
- **Credentials and personal data stay out of logs.** A transport shows `[REDACTED]` in place of
  its SMTP password, OAuth2 tokens, provider key and DKIM private key when it is inspected,
  logged or serialized. `./otel` and `./logger` record addresses only when told to
  (`recordSensitiveData`, `recordMessage`); otherwise the addresses that error text names, such
  as the recipient of an SMTP rejection, are redacted. A receipt returned to the application
  keeps its full error text: logging it is the application's to scrub.
- **Webhooks are verified** (planned). A delivery event from a provider is accepted only with a
  valid signature and within a replay window.
- **The audit log can forget a person** (planned). Recipients are stored as a keyed hash and an
  encrypted block whose key can be destroyed, so a request to erase someone's data does not require
  editing an append-only log.
- **Drivers are the application's.** A queue or database driver passed in (BullMQ, MongoDB) is
  trusted the same as any other module the application `require`s; its connection security is the
  application's to configure.
