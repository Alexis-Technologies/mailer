# SMTP

SMTP (Simple Mail Transfer Protocol) is the standard protocol for sending emails
across networks, as defined in [RFC 5321].  Most email providers offer SMTP
servers alongside their proprietary APIs, making SMTP a universal fallback
option when specific transports aren't available for your email provider.
The SMTP protocol provides reliable, widely-supported email delivery with
features like authentication, encryption, and delivery confirmation.

@alexify/mailer provides a comprehensive SMTP transport through the *@alexify/mailer/smtp* subpath,
offering connection pooling, TLS support, multiple authentication methods,
and efficient bulk sending capabilities.

> [!CAUTION]
> The SMTP transport currently does not support edge functions or web browsers.
> If you need to use @alexify/mailer in these environments, consider using other transports
> like [Mailgun](/transports/mailgun) or similar services that provide HTTP APIs.

[RFC 5321]: https://datatracker.ietf.org/doc/html/rfc5321

## Installation

To use the SMTP transport, you need to install the *@alexify/mailer/smtp* subpath:

```bash
pnpm add @alexify/mailer
# or
npm install @alexify/mailer
```

## Basic usage

The SMTP transport requires connection details for your SMTP server,
including the hostname, port, and authentication credentials.
Most email providers offer SMTP access through their settings or
developer documentation.

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');
const { createMessage } = require('@alexify/mailer');

// Create transport with basic configuration
const transport = new SmtpTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'your-email@gmail.com',
    pass: 'your-app-password',
  },
});

const message = createMessage({
  from: 'sender@example.com',
  to: 'recipient@example.com',
  subject: 'Hello from mailer SMTP',
  content: { text: 'This email was sent using the SMTP transport.' },
});

const receipt = await transport.send(message);
if (receipt.successful) {
  console.log('Message sent with ID:', receipt.messageId);
} else {
  console.error('Send failed:', receipt.errorMessages.join(', '));
}

// Clean up connections when done
await transport.closeAllConnections();
```

The transport automatically handles connection management, protocol negotiation,
and message formatting. When you're finished sending emails, it's important to
close connections to free up resources.

## Automatic resource management

Modern JavaScript environments support automatic resource cleanup using
the [`await using`] statement, which automatically closes SMTP connections
when the transport goes out of scope:

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');
const { createMessage } = require('@alexify/mailer');

await using transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  auth: {
    user: 'username',
    pass: 'password',
  },
});

const message = createMessage({
  from: 'system@example.com',
  to: 'user@example.com',
  subject: 'System Notification',
  content: { text: 'Your backup completed successfully.' },
});

await transport.send(message);
// Connections are automatically closed when transport goes out of scope
```

This approach eliminates the need to manually call
`SmtpTransport.closeAllConnections()` and ensures proper cleanup
even if errors occur.

[`await using`]: https://github.com/tc39/proposal-async-explicit-resource-management#await-using-declarations

## Connection configuration

The SMTP transport offers extensive configuration options to work with different
email providers and security requirements.  Connection settings control
timeouts, pooling, and protocol behavior:

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');

const transport = new SmtpTransport({
  host: 'mail.example.com',
  port: 587,
  secure: false,
  requireTls: true,
  auth: {
    user: 'user@example.com',
    pass: 'secure-password',
    method: 'plain',
  },
  connectionTimeout: 30000,
  socketTimeout: 60000,
  localName: 'mail.mycompany.com',
  pool: true,
  poolSize: 10,
});
```

The `SmtpConfig.host` and `SmtpConfig.port` specify your SMTP server details,
while `SmtpConfig.secure` determines whether to use implicit TLS and
`SmtpConfig.requireTls` makes a STARTTLS upgrade mandatory for plaintext
connections.  Connection and socket timeouts prevent hanging connections, and
the `SmtpConfig.localName` identifies your server during the SMTP handshake.
Without one, EHLO gives the host name of this machine when it is a fully
qualified domain name, its address as an address literal, or `[127.0.0.1]`, as
nodemailer does; a server that checks the name, such as Postfix with
`reject_non_fqdn_helo_hostname`, refuses `localhost`.  A name with whitespace or
a control character is refused when the transport is made.

The server writes the EHLO name into the `Received` field it adds to each
message, which every recipient can read, so the default tells them the host
name of the machine that sent it, an internal one such as
`ip-10-0-1-5.ec2.internal` included.  Set `localName` to the public name of
the sending host (one whose address resolves back to it) wherever the machine's
own name should stay private.

Connection pooling improves performance by reusing connections across multiple
messages.

`SmtpConfig.poolSize` caps how many connections one transport may have open at
the same time.  The cap counts connections that are being established,
connections that are currently sending, and idle connections kept for reuse, so
it applies whether or not `SmtpConfig.pool` is enabled.  Concurrent
`SmtpTransport.send()` and `SmtpTransport.sendMany()` calls that arrive once
the cap is reached wait for a connection to be handed back rather than opening
another one, which is what lets you match `SmtpConfig.poolSize` to the
simultaneous-connection limit your provider enforces.  A waiting call still
honours its `AbortSignal`, so cancelling it rejects without sending the message.
Setting `SmtpConfig.poolSize` to `Infinity` opts out of the limit entirely.

A connection handed back to the pool is reset (`RSET`) when it is next taken,
under the signal of the call that takes it, rather than before the previous
send returns its receipt. The reset also tells whether the server kept the
connection while it sat idle: one that fails its reset is closed, and the call
takes another connection or opens a new one. An idle connection does not keep
the process alive, so a script that sends a message and returns can exit
without `closeAllConnections()`, though closing still ends the session politely
with QUIT.

A connection sends `maxMessages` messages (100 by default, as nodemailer's pool),
then it is closed with QUIT and the next message opens a new one, within a
`sendMany()` batch too: servers limit the messages of one connection and answer
the next with an error.  Pass `Infinity` to keep a connection for good.

> [!NOTE]
> Because a `SmtpTransport.sendMany()` call holds its connection until the
> iteration ends, running more concurrent `SmtpTransport.sendMany()` calls than
> `SmtpConfig.poolSize` makes the extra ones wait for an earlier iteration to
> finish.  Raise `SmtpConfig.poolSize`, or use separate transports, when you
> need more bulk streams at once.

### Identifiers and `fetch`

`generateId` makes the left half of the Message-ID the transport gives a message
without one, and the message ID of a receipt the server named none for (see
[Identifiers of your own](/messages/compose#identifiers-of-your-own)). `fetch`
is used for the token refresh of OAuth 2.0, in place of the global one, such as
one bound to an undici `Agent` or a proxy.

### Proxies and connections of your own

`connect` opens each connection in place of a TCP connection to `host` and
`port`, as nodemailer's `getSocket` does: through a proxy, a tunnel, or a socket
from another module.  `createHttpProxyConnector()` makes one for an HTTP or HTTPS
proxy that accepts `CONNECT`:

```js
const { SmtpTransport, createHttpProxyConnector } = require('@alexify/mailer/smtp');

const transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 465,
  auth: { user: 'user@example.com', pass: 'secret' },
  connect: createHttpProxyConnector({
    url: 'https://proxy-user:proxy-pass@proxy.internal:3129',
    tls: { ca: [proxyCa] },
  }),
});
```

The credentials of the proxy URL go as Basic authentication, as UTF-8, which is
the password itself: they go to an `http://` proxy only on this machine, and to
another only with `allowPlaintextCredentials: true`, for a network where that is
accepted. `headers` adds fields to each CONNECT request, and `timeout` bounds the
whole exchange, from the connection to the answer (30 s).  A
SOCKS proxy is a module of your own in `connect`, which receives `{ host, port,
localAddress, signal }` and resolves to a connected `net.Socket`, paused or with
nothing read from it yet:

```js
const { SocksClient } = require('socks');

const transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 587,
  connect: async ({ host, port }) => {
    const { socket } = await SocksClient.createConnection({
      proxy: { host: '127.0.0.1', port: 1080, type: 5 },
      command: 'connect',
      destination: { host, port },
    });
    return socket;
  },
});
```

`secure: true` and STARTTLS put TLS over the socket the connector gives, checked
against `host` as over a TCP connection, and the connection timeout and the
cancellation of the send abort its `signal`.  Authentication in plain text, which
the transport allows only to this machine, is allowed through a connector only
when `host` itself is a loopback host: the peer of a tunnel is the proxy, often
on this machine, not the server.

`localAddress` names the address of this machine to connect from, on one with
several.

### Diagnostics

A `logger`, pino-like, hears what the receipts do not tell: `debug` for a
connection made, upgraded with STARTTLS, authenticated, reused from the pool or
dropped after a failed reset, and `trace` for the commands and reply codes of
the protocol, with the argument of AUTH, the SASL exchange and every address
replaced by `[REDACTED]`. A connection that goes out in plain text to a host
other than this machine, because the server offers no STARTTLS and `requireTls`
is off, is a `warn` with the code `MAILER_SMTP_PLAINTEXT`; without a logger,
that warning, and the one of a DKIM signature skipped under `send-unsigned`,
go to `console.warn`, and nothing else is written.

## Command pipelining

When a server advertises the `PIPELINING` extension defined by [RFC 2920], @alexify/mailer
sends `MAIL FROM` and all `RCPT TO` commands together instead of waiting for a
reply after each command.  This cuts the number of network round trips for
messages with multiple recipients.  @alexify/mailer then reads every reply in command
order, including multiline replies, before continuing with `DATA`.

Pipelining is negotiated automatically and does not require a configuration
option.  Servers that do not advertise it keep the standard sequential command
flow.  A rejected recipient is still reported through
`SmtpReceipt.rejectedRecipients` when at least one other recipient accepts the
message.

[RFC 2920]: https://www.rfc-editor.org/rfc/rfc2920

## Message size declaration

@alexify/mailer automatically uses the `SIZE` extension defined by [RFC 1870] when the
server advertises it.  The transport adds the encoded message size in octets to
`MAIL FROM`, allowing the server to reject the message before its content is
uploaded.

If the server advertises a fixed maximum, @alexify/mailer returns a failed receipt without
sending `MAIL FROM` when the message exceeds that limit, of category `unsupported`
(code `smtp.message-size-exceeded`): not retried, and failed over by
[`./pool`](/transports/pool) to a transport whose limit the message is under.  A bare `SIZE`
capability, or `SIZE 0`, means that no fixed maximum was advertised, so @alexify/mailer
still declares the message size without rejecting it locally.  Servers that do
not advertise `SIZE` retain the existing SMTP flow.

The declared size covers the headers, encoded body, and line endings sent after
the server accepts `DATA`.  It does not include the DATA terminator or dots
added for SMTP transparency.

[RFC 1870]: https://www.rfc-editor.org/rfc/rfc1870

## Enhanced status codes

SMTP servers can prefix reply text with an enhanced status code such as
`5.1.1`, as defined by [RFC 2034] and [RFC 3463].  When a failure contains a
valid code, @alexify/mailer preserves the final reply line's text in
`providerDetails.response` and exposes the parsed value through
`providerDetails.enhancedStatusCode`.  The parsed
`SmtpEnhancedStatusCode` contains the complete `code` and numeric `class`,
`subject`, and `detail` fields.

Use `isSmtpResponseProviderDetails()` to narrow the provider-specific details:

```js
const { isSmtpResponseProviderDetails } = require('@alexify/mailer/smtp');

const error = receipt.successful ? undefined : receipt.errors?.[0];
if (isSmtpResponseProviderDetails(error?.providerDetails)) {
  const status = error.providerDetails.enhancedStatusCode;
  if (status != null) {
    console.log(status.code, status.class, status.subject, status.detail);
  }
}
```

If delivery succeeds for at least one recipient, each rejected entry in
`SmtpReceipt.rejectedRecipients` exposes its enhanced code through
`SmtpRejectedRecipient.enhancedStatusCode`.

@alexify/mailer uses the enhanced subject to refine categories where its meaning is
unambiguous.  Address and message-content statuses use `validation`, while
network/routing statuses use `network`.  Other subjects retain the category
derived from the traditional reply class.  A `4.x.x` code remains retryable and
a `5.x.x` code remains non-retryable.

A connection that closes, times out or fails after the end of the message data
went out (the terminating dot) leaves it unknown whether the server accepted
the message.  Such a failure has the code `smtp.delivery-unknown`, is marked
`deliveryUnknown: true` and is not retryable, since sending it again could
deliver it twice.  The same failure before the dot stays retryable.

The enhanced code must appear at the start of the reply text, use fields of one
to three digits without leading zeroes, and have the same class as the
three-digit SMTP reply.  If any condition is not met, @alexify/mailer preserves the reply
line's text but ignores the enhanced code.  Servers that return only
traditional replies continue to work unchanged.  Because the code space is
extensible through the [IANA registry], @alexify/mailer does not reject an otherwise valid
code merely because its subject or detail is unknown.

[RFC 2034]: https://www.rfc-editor.org/rfc/rfc2034
[RFC 3463]: https://www.rfc-editor.org/rfc/rfc3463
[IANA registry]: https://www.iana.org/assignments/smtp-enhanced-status-codes/

## Envelope overrides

Use the `envelope` send option when delivery errors or recipient routing need
addresses that differ from the visible message headers.  The following message
still displays `billing@example.com` as its From address and
`customer@example.net` as its To address:

```js
const { createMessage } = require('@alexify/mailer');
const { SmtpTransport } = require('@alexify/mailer/smtp');

const transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 465,
  secure: true,
});
const message = createMessage({
  from: 'billing@example.com',
  to: 'customer@example.net',
  subject: 'Invoice',
  content: { text: 'Your invoice is attached.' },
});

await transport.send(message, {
  envelope: {
    from: 'bounces+customer-42@bounce.example.com',
    to: ['delivery@example.net'],
  },
});
```

`SmtpEnvelopeOptions.from` controls `MAIL FROM`, while
`SmtpEnvelopeOptions.to` supplies the addresses for `RCPT TO`.  Omit either
field to derive that side from the message as before.  Set `from` to `null` for
the null reverse-path used by delivery notifications:

```js
const { createMessage } = require('@alexify/mailer');
const { SmtpTransport } = require('@alexify/mailer/smtp');

const transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 465,
  secure: true,
});
const notification = createMessage({
  from: 'postmaster@example.com',
  to: 'sender@example.net',
  subject: 'Delivery status notification',
  content: { text: 'The message could not be delivered.' },
});

await transport.send(notification, {
  envelope: { from: null },
});
```

The option also accepts a resolver for bulk VERP delivery.  The resolver
receives each message and its zero-based position in the send operation:

```js
const { createMessage } = require('@alexify/mailer');
const { SmtpTransport } = require('@alexify/mailer/smtp');

const transport = new SmtpTransport({
  host: "smtp.example.com",
  port: 465,
  secure: true,
});
const messages = [
  createMessage({
    from: "newsletter@example.com",
    to: "first@example.net",
    subject: "Newsletter",
    content: { text: "Hello, first subscriber." },
  }),
  createMessage({
    from: "newsletter@example.com",
    to: "second@example.net",
    subject: "Newsletter",
    content: { text: "Hello, second subscriber." },
  }),
];

for await (const receipt of transport.sendMany(messages, {
  envelope: (_message, index) => ({
    from: `bounces+${index}@bounce.example.com`,
  }),
})) {
  console.log(receipt);
}
```

A plain override applies to every message passed to
`SmtpTransport.sendMany()`.  Invalid addresses and empty recipient lists
produce a non-retryable failed receipt with the code `smtp.envelope-invalid`.
@alexify/mailer rejects them before sending `MAIL FROM`, and a bad item in `sendMany()`
does not prevent later messages from using the same connection.

The effective envelope drives DSN recipient validation and SMTPUTF8
negotiation.  Mailbox addresses written to visible From, To, Cc, and Reply-To
headers can still require SMTPUTF8 even when the envelope overrides them.  The
override does not alter message headers or DKIM signatures.

## Internationalized addresses

@alexify/mailer automatically uses the `SMTPUTF8` extension defined by [RFC 6531] when the
effective SMTP envelope or a visible From, To, Cc, or Reply-To mailbox contains
a non-ASCII local part.  The default envelope includes the message's Bcc
addresses.  The transport requires the server to advertise both `SMTPUTF8` and
`8BITMIME`, then adds `BODY=8BITMIME SMTPUTF8` to `MAIL FROM`.  This supports
UTF-8 local parts without another configuration option.

A Unicode domain under an ASCII local part does not require SMTPUTF8: the envelope
(including an `envelope` override and the envelope of a raw message) and the header
fields carry its A-label, so `user@bücher.de` goes as `RCPT TO:<user@xn--bcher-kva.de>`
to any server.

If either required extension is missing, @alexify/mailer returns a non-retryable failed
receipt with the code `smtp.smtputf8-unsupported` before sending `MAIL FROM`.
The connection remains available for a later ASCII-only message.

Unicode display names and subjects do not by themselves require SMTPUTF8.
@alexify/mailer continues to encode those values as RFC 2047 encoded words, so an address
such as `José <jose@example.com>` follows the ordinary ASCII SMTP flow, and so does
`support@例え.テスト`, written as `support@xn--r8jz45g.xn--zckzah`.  A verbatim custom
header with a Unicode address in it is written as given and does require SMTPUTF8.

[RFC 6531]: https://www.rfc-editor.org/rfc/rfc6531

## Delivery status notifications

Use the `dsn` send option to request delivery status notifications through the
SMTP `DSN` extension defined by [RFC 3461].  These settings become parameters
on `MAIL FROM` and `RCPT TO`; they are not message headers.

```js
const { createMessage } = require('@alexify/mailer');
const { SmtpTransport } = require('@alexify/mailer/smtp');

const transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 465,
  secure: true,
});
const message = createMessage({
  from: 'sender@example.com',
  to: ['first@example.com', 'second@example.com'],
  subject: 'Delivery report',
  content: { text: 'Track this delivery.' },
});

const receipt = await transport.send(message, {
  dsn: {
    envelopeId: 'campaign+42',
    return: 'headers',
    recipients: {
      'first@example.com': {
        notify: ['success', 'failure', 'delay'],
        originalRecipient: 'first@example.com',
      },
      'second@example.com': {
        notify: ['never'],
      },
    },
  },
});
```

`SmtpDsnOptions.envelopeId` sets `ENVID`, a non-empty identifier copied into a
later notification.  `SmtpDsnOptions.return` sets `RET=FULL` or `RET=HDRS`
and controls how much of a failed message may be returned.  Each key in
`SmtpDsnOptions.recipients` must exactly match an address in the effective
SMTP envelope.  When `SmtpTransportOptions.envelope` replaces the recipients,
the DSN keys must match the replacement addresses rather than the message's To,
Cc, or Bcc fields.

The `SmtpDsnRecipientOptions.notify` array accepts `"success"`, `"failure"`,
and `"delay"`.  Use `["never"]` by itself to suppress notifications for one
recipient.  If `notify` is omitted, the server keeps its default failure and
optional delay behavior.  `SmtpDsnRecipientOptions.originalRecipient` sets an
`ORCPT` value with the `rfc822` address type.  On initial submission, RFC 3461
requires this value to equal the corresponding envelope recipient.

@alexify/mailer validates notification combinations, recipient keys, parameter lengths,
and the printable US-ASCII range before sending the SMTP envelope.  It also
applies RFC 3461 `xtext` escaping to spaces, plus signs, and equals signs in
`ENVID` and `ORCPT`.  @alexify/mailer emits the RFC 3461 `rfc822` form and does not
implement the UTF-8 address type or encodings defined by [RFC 6533].

If any DSN parameter is requested but the server does not advertise `DSN`, the
send returns a non-retryable failed receipt with the code
`smtp.dsn-unsupported`; @alexify/mailer does not send `MAIL FROM`.  Invalid settings use
the code `smtp.dsn-invalid`.  An empty `dsn` object has no effect, preserving
the ordinary SMTP flow.

The SMTP server sends a requested notification later as a separate message in
the [RFC 3464] format.  A successful `SmtpTransport.send()` receipt confirms
only that the server accepted the original message; it is not the later DSN.

When passed to `SmtpTransport.sendMany()`, one `dsn` option applies to every
message.  Every configured recipient key must therefore be present in each
effective envelope.  Call `SmtpTransport.send()` separately when messages
need different DSN settings.

[RFC 3461]: https://www.rfc-editor.org/rfc/rfc3461
[RFC 6533]: https://www.rfc-editor.org/rfc/rfc6533
[RFC 3464]: https://www.rfc-editor.org/rfc/rfc3464

## Authentication methods

The SMTP transport supports multiple authentication mechanisms commonly used by
email providers.  The most widely supported method is PLAIN authentication,
which works with virtually all SMTP servers:

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');

// PLAIN authentication (most common)
const gmailTransport = new SmtpTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'your-email@gmail.com',
    pass: 'your-app-password',
    method: 'plain',
  },
});

// LOGIN authentication for older servers
const outlookTransport = new SmtpTransport({
  host: 'smtp-mail.outlook.com',
  port: 587,
  secure: false,
  auth: {
    user: 'your-email@outlook.com',
    pass: 'your-password',
    method: 'login',
  },
});
```

When using services like Gmail, you'll need to generate an app-specific password
rather than using your regular account password.  Without `method`, a password
signs in with PLAIN, and OAuth 2.0 credentials with XOAUTH2 when the server
offers it, OAUTHBEARER otherwise.  CRAM-MD5 is not supported, and a method the
transport does not know is refused when the transport is made.

> [!IMPORTANT]
> SMTP authentication requires a secure connection (`secure: true`, or a
> successful STARTTLS upgrade on port 587).  To protect passwords and access
> tokens, authentication over a cleartext connection to a non-loopback host is
> refused.  Loopback hosts remain available for local development: `localhost`,
> a name under `.localhost`, 127.0.0.0/8 and `::1` (also IPv4-mapped), the same
> hosts to which an OAuth 2.0 token endpoint may use plain `http:`.

### OAuth 2.0 authentication

Many providers—including Gmail and Outlook—now require OAuth 2.0 instead of
passwords.  The transport supports the SASL *XOAUTH2* mechanism (the de-facto
standard used by Google and Microsoft) and *OAUTHBEARER* ([RFC 7628]).  Instead
of `pass`, provide an `accessToken`:

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');

const transport = new SmtpTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'your-email@gmail.com',
    accessToken: 'ya29.a0Af…your-access-token',
  },
});
```

When `method` is omitted, the transport selects a mechanism advertised by the
server, preferring *XOAUTH2*.  Set `method: "oauthbearer"` to force OAUTHBEARER.

#### Refreshing tokens automatically

Access tokens are short-lived, so a static string is rarely enough.  To refresh
tokens transparently, pass a callback as `accessToken`.  It is invoked each time
a new connection authenticates, which lets you delegate to an OAuth client such
as [google-auth-library] (Gmail) or [msal-node] (Outlook):

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');

const transport = new SmtpTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'your-email@gmail.com',
    // Called for every new connection; obtain a fresh token here.
    accessToken: () => getFreshAccessToken(),
  },
});
```

Alternatively, let the transport run the `refresh_token` grant itself.  Provide
your client credentials, a refresh token, and the token endpoint; the transport
exchanges them for an access token and caches it until shortly before it
expires, sharing the cached token across all pooled connections:

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');

const transport = new SmtpTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'your-email@gmail.com',
    clientId: '…apps.googleusercontent.com',
    clientSecret: 'GOCSPX-…',
    refreshToken: '1//…',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
  },
});
```

Because a connection authenticates once when it is established, the callback or
refresh runs per new connection rather than per message.

[RFC 7628]: https://www.rfc-editor.org/rfc/rfc7628
[google-auth-library]: https://github.com/googleapis/google-auth-library-nodejs
[msal-node]: https://github.com/AzureAD/microsoft-authentication-library-for-js/tree/dev/lib/msal-node

## TLS and security configuration

Security is crucial for email transmission, and the SMTP transport provides
comprehensive TLS configuration options.  You can control encryption,
certificate validation, and TLS protocol versions:

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');

const transport = new SmtpTransport({
  host: 'secure-smtp.example.com',
  port: 465,
  secure: true,
  auth: {
    user: 'secure@example.com',
    pass: 'password',
  },
  tls: {
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    ca: ['-----BEGIN CERTIFICATE-----\n...'],
  },
});
```

Setting `secure: true` establishes a TLS connection from the start,
while `rejectUnauthorized: true` ensures certificate validation.
You can specify custom certificate authorities, client certificates,
and acceptable TLS versions based on your security requirements.
Both implicit TLS and STARTTLS send the host name for SNI, so a server with a
certificate per name answers with the one for `host`; a host given as an IP
address sends none, as SNI carries only names.

### STARTTLS support

The SMTP transport automatically supports STARTTLS, which allows upgrading
a plain connection to an encrypted TLS connection.  When `secure` is set to
`false` and the server advertises STARTTLS capability, the transport will
automatically upgrade the connection before authentication.  Set `requireTls`
to `true` when the connection must be encrypted even if the server does not
advertise STARTTLS:

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');

// STARTTLS will be used automatically with port 587
const transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 587, // Standard submission port with STARTTLS
  secure: false, // Start with plain connection
  requireTls: true, // Fail unless the STARTTLS upgrade succeeds
  auth: {
    user: 'user@example.com',
    pass: 'password',
  },
});
```

This configuration is commonly used with port 587 (mail submission port)
and is required by many modern email providers including Protonmail, Office 365,
and others that enforce encryption via STARTTLS.  When `requireTls` is `true`,
the transport issues `STARTTLS` even if the server does not advertise the
capability and fails delivery if the upgrade is rejected or cannot be
completed.  This also protects message content on connections that do not use
SMTP authentication.  The transport follows [RFC 3207] for STARTTLS negotiation
and automatically re-negotiates capabilities after the connection is upgraded.

> [!TIP]
> Use `secure: false` with `requireTls: true` on port 587 for mandatory
> STARTTLS, or `secure: true` on port 465 for direct TLS connections.  Even when
> `requireTls` is `false`, the transport refuses to authenticate to a
> non-loopback server over cleartext.

[RFC 3207]: https://datatracker.ietf.org/doc/html/rfc3207

## DKIM signing

DKIM (DomainKeys Identified Mail) is an email authentication method that allows
the sender to attach a digital signature to outgoing emails.  This helps
recipients verify that the email was actually sent from the claimed domain
and hasn't been modified in transit, improving deliverability and reducing
the chance of emails being marked as spam.

The SMTP transport supports DKIM signing through the `SmtpConfig.dkim`
configuration option.  DKIM signatures are generated using the standard
Web Crypto API of Node.js.

> [!NOTE]
> The DKIM implementation follows [RFC 6376] and [RFC 8463], supporting both
> `rsa-sha256` (most widely used) and `ed25519-sha256` (shorter keys)
> algorithms.

[RFC 6376]: https://www.rfc-editor.org/rfc/rfc6376
[RFC 8463]: https://www.rfc-editor.org/rfc/rfc8463

### Basic DKIM configuration

To enable DKIM signing, provide a `dkim` configuration with your private key
and domain information:

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');
const { readFileSync } = require('node:fs');

const transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  auth: {
    user: 'user@example.com',
    pass: 'password',
  },
  dkim: {
    signatures: [
      {
        signingDomain: 'example.com',
        selector: 'mail',
        privateKey: readFileSync('./dkim-private.pem', 'utf8'),
      },
    ],
  },
});
```

The `signingDomain` should match your email's From address domain, and the
`selector` is used to look up the public key in DNS
(e.g., `mail._domainkey.example.com`).

### DkimSignature options

Each signature in the `signatures` array can have the following options:

| Option             | Type                               | Default                             | Description                           |
| ------------------ | ---------------------------------- | ----------------------------------- | ------------------------------------- |
| `signingDomain`    | `string`                           | (required)                          | Domain for DKIM key (d= tag)          |
| `selector`         | `string`                           | (required)                          | DKIM selector (s= tag)                |
| `privateKey`       | `string \| CryptoKey`              | (required)                          | Private key (PEM string or CryptoKey) |
| `algorithm`        | `"rsa-sha256" \| "ed25519-sha256"` | `"rsa-sha256"`                      | Signing algorithm (a= tag)            |
| `canonicalization` | `string`                           | `"relaxed/relaxed"`                 | Header/body canonicalization (c= tag) |
| `headerFields`     | `string[]`                         | see below                           | Headers to sign (h= tag)              |

By default the signature covers From, Reply-To, Subject, To, Cc, Date,
Message-ID, In-Reply-To, References, MIME-Version, Content-Type,
List-Unsubscribe and List-Unsubscribe-Post (which one-click unsubscription
needs signed, RFC 8058 §4), present or not, since a field absent when signed cannot be added afterwards without
breaking the signature; From, Reply-To and Subject are listed twice, so that a
second instance cannot be added either (over-signing, RFC 6376 §8.15). A name
listed more than once in `headerFields` signs the instances of that field from
the bottom up, as RFC 6376 §5.4.2 says.

The signing domain and the selector must be domain names (letters, digits and
hyphens, or U-labels that convert to such A-labels), the field names printable
ASCII without `:` or `;`, and the algorithm and canonicalization among those
above; anything else throws a `TypeError` when the transport is made, since
these values are written into the `DKIM-Signature` field as they are. A PEM key
is read when the transport is made too, so a broken key fails there rather than
at the first message (unless `onSigningFailure` is `send-unsigned`), and it is
imported once per signature configuration, not once per message.

### Using Ed25519 keys

Ed25519 offers shorter keys than RSA while providing equivalent security.
This is particularly useful when DNS TXT record size is a concern:

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');
const { readFileSync } = require('node:fs');

const transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  auth: {
    user: 'user@example.com',
    pass: 'password',
  },
  dkim: {
    signatures: [
      {
        signingDomain: 'example.com',
        selector: 'ed25519',
        privateKey: readFileSync('./dkim-ed25519.pem', 'utf8'),
        algorithm: 'ed25519-sha256',
      },
    ],
  },
});
```

### Using `CryptoKey`

If you already have a [`CryptoKey`] object (from Web Crypto API),
you can pass it directly instead of a PEM string:

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');

// Import a private key using Web Crypto API
const privateKey = await crypto.subtle.importKey(
  'pkcs8',
  new Uint8Array([/* ... key bytes ... */]),
  { name: 'Ed25519' },
  false,
  ['sign'],
);

const transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  dkim: {
    signatures: [
      {
        signingDomain: 'example.com',
        selector: 'mykey',
        privateKey: privateKey, // CryptoKey object
        algorithm: 'ed25519-sha256',
      },
    ],
  },
});
```

[`CryptoKey`]: https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey

### Body processing

*Since @alexify/mailer 0.6.0.*

`dkim.bodyMode` selects how attachment bytes are read for signing:

| Mode                   | Source reads per send | Additional attachment memory                |
| ---------------------- | --------------------- | ------------------------------------------- |
| No DKIM signatures     | One                   | Fixed buffers plus the largest source chunk |
| `"buffered"` (default) | One                   | Complete MIME body                          |
| `"streaming"`          | Two                   | Fixed buffers plus the largest source chunk |

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');
const { readFileSync } = require('node:fs');

const transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 465,
  secure: true,
  dkim: {
    bodyMode: 'streaming',
    signatures: [
      {
        signingDomain: 'example.com',
        selector: 'mail',
        privateKey: readFileSync('./dkim-private.pem', 'utf8'),
      },
    ],
  },
});
```

Streaming hashes the body before `MAIL FROM`, then reopens the attachment
sources for DATA.  All signatures share these two reads.  The extra I/O and
hashing delay delivery and hold an authenticated connection during the first
pass; the receiving server's idle limit still applies.  The memory bound
excludes caller-owned data, text/HTML, headers, and runtime/socket buffers.  An
empty `signatures` array behaves like unsigned sending.

Attachment factories must reopen identical bytes on every invocation.  A changed
second pass fails before the DATA terminator with the non-retryable
`smtp.attachment-replay-mismatch` receipt code.  Source errors, cancellation,
size-limit failures, and replay mismatches never trigger `send-unsigned`
fallback. If a later signature fails cryptographically, earlier successful
signatures remain on the message.

Unsigned factory sources have no known size, so SMTP omits the optional
`MAIL FROM SIZE` parameter and enforces the server's advertised limit while
writing DATA.  Known byte-array and `Blob` sizes are checked before `MAIL FROM`.
DKIM's first pass establishes the final size before submission.  A failure
during DATA closes the connection without accepting a truncated message.

`socketTimeout` measures inactivity while reading or writing attachments, not
total transfer duration.  Nonempty source progress and completed writes reset
the timer; an endless stream of empty chunks does not.  Cancellation is passed
to the source, and failed DATA connections are not returned to the pool.

See
[attachment factories](/messages/attachments#working-with-binary-content)
for file-backed sources and the custom-transport migration guide.

### Multiple DKIM signatures

You can add multiple DKIM signatures to a single email, which is useful when
sending on behalf of multiple domains or when rotating keys:

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');
const { readFileSync } = require('node:fs');

const transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  auth: {
    user: 'user@example.com',
    pass: 'password',
  },
  dkim: {
    signatures: [
      {
        signingDomain: 'example.com',
        selector: 'mail2024',
        privateKey: readFileSync('./dkim-2024.pem', 'utf8'),
      },
      {
        signingDomain: 'example.com',
        selector: 'mail2025',
        privateKey: readFileSync('./dkim-2025.pem', 'utf8'),
      },
    ],
  },
});
```

### Error handling

By default, if DKIM signing fails (e.g., due to an invalid private key),
the transport throws an error.  You can change this behavior using the
`onSigningFailure` option:

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');

const transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  auth: {
    user: 'user@example.com',
    pass: 'password',
  },
  dkim: {
    signatures: [
      {
        signingDomain: 'example.com',
        selector: 'mail',
        privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
      },
    ],
    onSigningFailure: 'send-unsigned', // or "throw" (default)
  },
});
```

With `onSigningFailure: "send-unsigned"`, the email will be sent without
a DKIM signature if signing fails, rather than failing the entire send
operation.

## Bulk email sending

For sending multiple emails efficiently, the SMTP transport provides
a `SmtpTransport.sendMany()` method that reuses connections and handles errors
gracefully.  This approach is much more efficient than
calling `SmtpTransport.send()` multiple times:

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');
const { createMessage } = require('@alexify/mailer');

await using transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  auth: {
    user: 'bulk@example.com',
    pass: 'password',
  },
  poolSize: 5,
});

const messages = [
  createMessage({
    from: 'newsletter@example.com',
    to: 'subscriber1@example.com',
    subject: 'Weekly Newsletter #1',
    content: { text: 'Welcome to our newsletter!' },
  }),
  createMessage({
    from: 'newsletter@example.com',
    to: 'subscriber2@example.com',
    subject: 'Weekly Newsletter #2',
    content: { text: 'Thank you for subscribing!' },
  }),
];

for await (const receipt of transport.sendMany(messages)) {
  if (receipt.successful) {
    console.log(`Message ${receipt.messageId} sent successfully`);
  } else {
    console.error(`Failed to send message: ${receipt.errorMessages.join(', ')}`);
  }
}
```

The `SmtpTransport.sendMany()` method processes messages sequentially,
providing individual receipts for each message.  Connection pooling ensures
efficient resource usage, and failed messages don't prevent subsequent messages
from being sent.  The whole iteration runs on a single connection drawn from the
same `SmtpConfig.poolSize` budget as `SmtpTransport.send()`.

## Development and testing

For local development and testing, you can use development SMTP servers or
configure the transport for testing environments.  The package supports various
testing scenarios including mock servers:

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');

// Local development with Mailpit (popular SMTP testing tool)
const devTransport = new SmtpTransport({
  host: 'localhost',
  port: 1025,
  secure: false,
  // No authentication needed for local testing
});

// Testing configuration with relaxed security
const testTransport = new SmtpTransport({
  host: 'test-smtp.example.com',
  port: 587,
  secure: false,
  auth: {
    user: 'test@example.com',
    pass: 'test-password',
  },
  tls: {
    rejectUnauthorized: false, // For self-signed certificates in test environments
  },
  connectionTimeout: 5000, // Shorter timeouts for faster test feedback
});
```

> [!TIP]
> [Mailpit] is an excellent development SMTP server that provides a modern
> web interface for testing email functionality.  It acts as an SMTP server
> that accepts all emails but doesn't deliver them, instead storing them
> locally for inspection.  Mailpit offers features like HTML and plain text
> email viewing, attachment downloads, search functionality, and even webhook
> testing for email events.
>
> You can install Mailpit as a standalone binary, run it via Docker,
> or use package managers like Homebrew.  The default configuration listens on
> port 1025 for SMTP and provides a web UI on port 8025, making it perfect for
> local development workflows where you need to verify email content and
> formatting without sending real emails.

[Mailpit]: https://mailpit.axllent.org/

## Sending raw MIME

Use [MIME composition](/messages/mime) to create raw bytes from an @alexify/mailer
message without opening a transport connection.

`SmtpTransport` implements `RawTransport` for already serialized messages,
including signed or encrypted MIME. Provide delivery addresses separately:

```js
const { SmtpTransport } = require('@alexify/mailer/smtp');

const transport = new SmtpTransport({ host: 'localhost', port: 1025 });
try {
  await transport.sendRaw({
    envelope: { from: 'sender@example.com', to: ['recipient@example.net'] },
    content: new TextEncoder().encode('Subject: Hello\r\n\r\nHello!\r\n'),
    encoding: '7bit',
  });
} finally {
  await transport.closeAllConnections();
}
```

Raw sources accept bytes, promised bytes, Blob, or replayable attachment-style
factories. With `encoding` specified, the source is read once; otherwise it is
analyzed and then read again. Every reader must produce identical bytes.
Automatic analysis requires SMTPUTF8 for any non-ASCII byte. Specify `8bit`
when all MIME headers are ASCII and only the body needs 8BITMIME. @alexify/mailer checks
only top-level headers; the caller must ensure nested MIME headers are ASCII.
Use `utf8` or omit `encoding` if unsure. Both `utf8` and internationalized
envelope addresses require SMTPUTF8 and 8BITMIME.
Unsupported capabilities produce a failed receipt before MAIL FROM.

The content must already have CRLF line endings including the final CRLF,
nonempty headers, no NUL, and no line longer than 998 bytes excluding CRLF.
SMTP delivery adds only dot-stuffing and protocol framing. It does not compose
headers, remove Bcc, add Date or Message-ID, or run configured DKIM signing.
The caller is responsible for the MIME structure and any existing signatures.

`sendRaw()` accepts `dsn` and `signal` options. Its envelope cannot be
overridden through options; use `envelope.from: null` for a null reverse-path.
Receipts include partial recipient rejections just like `send()`. The returned
message ID identifies the SMTP transaction, not necessarily the MIME Message-ID.

Known sizes exclude dot-stuffing and protocol framing. A factory with an
explicit encoding starts reading after the server accepts DATA and does not
need a preliminary size pass. Inactivity limits and cancellation cover reading
and writing; a failure during DATA closes that connection without completing
the message. Raw delivery is not retried automatically.

## Verifying the configuration

Call `SmtpTransport.verify()` to check your SMTP settings without sending
an email. It opens a fresh connection, checks the server greeting and
EHLO/HELO negotiation, applies the same TLS policy as sending, and performs
any configured authentication, including OAuth 2.0. Relay configurations
without authentication are supported.

```js
const { SmtpAuthError, SmtpResponseError, SmtpTransport } = require('@alexify/mailer/smtp');

await using transport = new SmtpTransport({
  host: 'smtp.example.com',
  port: 587,
  requireTls: true,
});

try {
  await transport.verify({ signal: AbortSignal.timeout(10_000) });
} catch (error) {
  if (error instanceof SmtpAuthError) {
    console.error('Check the SMTP credentials.');
  } else if (error instanceof SmtpResponseError) {
    console.error(error.command, error.code, error.response);
  } else {
    throw error;
  }
}
```

Unlike sending, verification rejects on failure and does not return a receipt.
`SmtpAuthResponseError` extends `SmtpAuthError` with the SMTP reply's `code`,
`command`, and `response`. Network, TLS, and timeout failures may use native
error types. Cancellation preserves the caller's abort reason.

Verification shares the transport's `poolSize` limit and shutdown barrier.
It waits when all slots are busy; when necessary, it replaces one idle
connection to make room for a fresh handshake. Its connection is closed
afterward, including on failure or cancellation, and is never pooled.
The existing connection and socket timeouts apply; use an abort signal to
bound the whole call, including waiting for capacity.

Success confirms setup at verification time. It does not guarantee that a
particular sender, recipient, or message will be accepted, or that delivery
will succeed. No envelope or message data is sent. Verification is an
[optional transport capability](/transports/custom#verifying-transport-configuration);
wrappers do not automatically expose it.
