# Known issues

The transport layer is ported from [upyo](https://github.com/dahlia/upyo) 0.7.0 and keeps its
behavior, bugs included, until each bug is fixed on its own with a test. This page lists the ones
still open; the fixed ones are in the [changelog](https://github.com/Alexis-Technologies/mailer/blob/main/CHANGELOG.md).

## Messages and MIME

- Inline images (`contentId`) go into `multipart/mixed` rather than `multipart/related`, so some
  clients show them as attachments.
- The first encoded word of a header shares its line with the field name
  (`Subject: =?UTF-8?B?…?=`), past the 76 characters that RFC 2047 allows such a line.
- DKIM: a PKCS#1 key (`BEGIN RSA PRIVATE KEY`) is imported as PKCS#8 and fails; convert it to
  PKCS#8 first.
- DKIM: when signing fails and `send-unsigned` is set, the warning goes to `console.warn`.

## SMTP

- `cram-md5` is in the `SmtpAuth` type but not implemented.

## HTTP providers and JMAP

- `validateSsl` is accepted and never read (SES, Resend, SendGrid, Mailgun, Mailtrap, Plunk).
- Mailgun sends an inline attachment under its file name rather than its `contentId`, so a
  `cid:` in the HTML does not match it.
- Resend's `Idempotency-Key` comes from `Math.random`.
- SES: custom and threading headers are not sent.
- Plunk: an attachment that cannot be read is left out with a `console.warn`.
- JMAP on Node 24: an authentication rejection (401) of a streamed request body (raw upload,
  import, raw submission) becomes a retryable network error, as Node's `fetch` reports it so.

## Decorators

- `./pool`: `continueOnSuccess` is never read.
- `./otel`: `durationBuckets` and `auto` are ignored, `recordRetry` is never called, `sendMany`
  buffers its whole input, the active sends gauge drifts under sampling, and the default error
  classifier matches `auth` and status codes as substrings of the message.
