# Sendmail transport

The sendmail transport hands each message to the `sendmail` command of the
system, the one Postfix, Exim, OpenSMTPD, msmtp and sendmail itself install, which
queues it and delivers it with the configuration of the machine.  It comes from
nodemailer's sendmail transport, with the fixes listed below.

## Installation

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

## Basic usage

```js
const { createMessage } = require('@alexify/mailer');
const { SendmailTransport } = require('@alexify/mailer/sendmail');

const transport = new SendmailTransport({ path: '/usr/sbin/sendmail' });

const receipt = await transport.send(
  createMessage({
    from: 'app@example.com',
    to: 'user@example.com',
    bcc: 'archive@example.com',
    subject: 'Welcome',
    content: { text: 'Hello!' },
  }),
);
if (receipt.successful) console.log(receipt.messageId);
```

Each message runs one process, `<path> -i -f <sender> -- <recipients…>`, and goes
to it on stdin, composed by *@alexify/mailer/mime*: the same MIME, DKIM signature,
encodings and IDN addresses as the SMTP transport.  `-i` keeps a line of a single
dot in the message, and `--` keeps an address from being read as an option; an
address that starts with `-` is refused anyway.  Blind recipients go on the
command line only: the message has no Bcc field for sendmail to strip.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `path` | `'sendmail'` | The command, a path or a name on PATH. |
| `args` | | Arguments in place of `-f <sender>`: `<path> -i <args…> -- <recipients…>`. |
| `newline` | `'lf'` | `'lf'`, which every sendmail takes, or `'crlf'`. |
| `timeout` | `60000` | How long a process may take; it is stopped then (SIGTERM, then SIGKILL), of unknown delivery once it had the whole message. 0 or `Infinity` for none. |
| `maxConcurrent` | `10` | The most processes at once; a send waits for a place. |
| `spawn` | `child_process.spawn` | Starts the process: pass your own to run sendmail in a container or as another user. |
| `dkim` | | A DKIM configuration, as for [SMTP](/transports/smtp#dkim-signing). |
| `generateId` | | Makes the left half of a Message-ID, and the id of a raw receipt. |
| `logger` | | A pino-like logger: `debug` when a process starts and exits. |

## Receipts

A send succeeds when sendmail exits with code 0 having read the whole message,
and the receipt carries the Message-ID of the message.  Any other end is a failed receipt, with what sendmail
wrote to stderr (its first 4 KiB, addresses replaced by `[REDACTED]`):

| Exit | Category | Retryable |
| --- | --- | --- |
| 75 `EX_TEMPFAIL`, 69 `EX_UNAVAILABLE` | `service-unavailable` | yes |
| 67 `EX_NOUSER`, 68 `EX_NOHOST` | `rejected` | no |
| 65 `EX_DATAERR` | `validation` | no |
| 64, 77, 78, 126, 127, command not found | `configuration` | no |
| any other code | `server-error` | no |
| killed by a signal | `server-error` | before it had the whole message; after, `deliveryUnknown` |
| past `timeout` | `timeout` | before it had the whole message; after, `deliveryUnknown` |
| 0 before it read the whole message | `server-error` | no, `deliveryUnknown` |

An abort of the `signal` stops the process, SIGTERM then SIGKILL five seconds
on, and its place among the `maxConcurrent` is free once it has exited.  A
message whose content cannot be read (an attachment that fails) kills it with
SIGINT, so that no part of it is
delivered.  `scheduledAt` is refused as `unsupported`, as sendmail cannot schedule.

## Raw messages and verification

`sendRaw()` pipes serialized MIME as it is but for its line endings, to the
recipients of its envelope, `-f <>` for a null sender.  `verify()` checks that the
command exists and is executable, at its path or on PATH; with `spawn` passed in,
which decides what runs, it checks nothing.

## What changed from nodemailer

- A process killed by a signal was a success there (`code === null`), and the code
  of `close` was handed on as an error value.  Here only an exit with 0 succeeds.
- stderr was never read; here it is, bounded and redacted, in the failure.
- The recipients followed the options with no `--`.
- The message kept its Bcc field for sendmail to strip, which depends on the MTA.
