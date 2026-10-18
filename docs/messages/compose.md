# Composing messages

Creating email messages in @alexify/mailer is straightforward and flexible. The library
provides the `createMessage()` function from the root entry, *@alexify/mailer*,
which accepts various input formats and automatically handles validation
and type conversion for you.

To serialize a message without sending it, use the
[MIME composition API](/messages/mime).

## Basic message creation

To create a simple email message, you need to provide at minimum a sender
address, recipient address, subject, and content. The `createMessage()` function
accepts these in a convenient object format:

```js
const { createMessage } = require('@alexify/mailer');

const message = createMessage({
  from: 'sender@example.com',
  to: 'recipient@example.net',
  subject: 'Hello from mailer!',
  content: { text: 'This is a test email.' },
});
```

The function automatically converts string email addresses to proper `Address`
objects and validates the input.  You can provide email addresses as simple
strings like `"user@example.com"` or with display names using the format
`"Name <user@server.com>"` like `"John Doe <john@example.com>"`.
You can also provide `Address` objects directly if you prefer to work with
the structured format.

## Multiple recipients

When you need to send an email to multiple recipients, you can provide arrays
for the `to`, `cc`, and `bcc` fields.  Each field accepts either a single
address or an array of addresses, and you can mix different formats including
plain email addresses, display name formats, and `Address` objects:

```js
const { createMessage } = require('@alexify/mailer');

const message = createMessage({
  from: 'Support Team <support@example.com>',
  to: ['recipient1@example.com', 'John Smith <john@example.com>'],
  cc: { name: 'Manager', address: 'manager@example.com' },
  bcc: ['archive@example.com', 'backup@example.com'],
  subject: 'Team Update',
  content: { text: "Here's the latest team update." },
});
```

You can also specify a custom reply-to address using the `replyTo` field,
which is useful when you want replies to go to a different address than
the sender:

```js
const { createMessage } = require('@alexify/mailer');

const message = createMessage({
  from: 'noreply@example.com',
  to: 'customer@example.com',
  replyTo: 'support@example.com',
  subject: 'Welcome to our service',
  content: { text: 'Thank you for signing up!' },
});
```

## Internationalized addresses

@alexify/mailer accepts internationalized mailbox addresses with UTF-8 local parts and
Unicode domains, as defined by the internationalized email framework in
[RFC 6530]:

```js
const { createMessage } = require('@alexify/mailer');

const message = createMessage({
  from: 'josé@example.com',
  to: '用户@例子.广告',
  subject: 'Hello',
  content: { text: 'Welcome!' },
});
```

The local part is limited to 64 UTF-8 octets.  @alexify/mailer preserves the spelling and
Unicode normalization supplied by the caller because changing a local part can
change the mailbox it identifies.

A Unicode domain under an ASCII local part needs no extension: when the message is
written, into its header fields, an SMTP envelope, a JMAP request or a provider's API,
the domain goes as its A-label (IDNA with the mapping of UTS #46, as browsers and DNS
resolvers apply it), so `user@bücher.de` is sent as `user@xn--bcher-kva.de`.  The
`Message` keeps the address as you gave it.  An address literal, and a local part beyond
ASCII with its domain, are written as given.

Provider support for a UTF-8 local part still depends on the selected transport.  The
[SMTP transport](/transports/smtp#internationalized-addresses) negotiates
the `SMTPUTF8` extension automatically and reports a failed receipt when the
server cannot accept an internationalized address.

[RFC 6530]: https://www.rfc-editor.org/rfc/rfc6530

## Rich content

@alexify/mailer supports both plain text and HTML email content.  You can provide just text
content, just HTML content, or both. When you provide both, email clients will
choose the appropriate format to display:

```js
const { createMessage } = require('@alexify/mailer');

const message = createMessage({
  from: 'newsletter@example.com',
  to: 'subscriber@example.com',
  subject: 'Monthly Newsletter',
  content: {
    html: '<h1>Welcome to our newsletter!</h1><p>This month we have exciting updates.</p>',
    text: 'Welcome to our newsletter! This month we have exciting updates.',
  },
});
```

A message can also carry an iCalendar object alongside the text and HTML, which
is what turns it into a meeting invitation rather than an email that mentions a
meeting.  See [Calendar invitations](/messages/calendar).

If you only need plain text, you can simply provide the `text` property:

```js
const { createMessage } = require('@alexify/mailer');

const message = createMessage({
  from: 'system@example.com',
  to: 'user@example.com',
  subject: 'System Notification',
  content: { text: 'Your backup has completed successfully.' },
});
```

## Message priority and organization

You can set the priority level of your messages to help recipients understand
their importance. @alexify/mailer supports three priority levels: `"high"`, `"normal"`,
and `"low"`:

```js
const { createMessage } = require('@alexify/mailer');

const message = createMessage({
  from: 'alerts@example.com',
  to: 'admin@example.com',
  subject: 'Server Alert',
  content: { text: 'The server is experiencing high load.' },
  priority: 'high',
});
```

For better organization and filtering, you can add tags to your messages.
Tags are simple strings that can help you categorize and search your
emails later:

```js
const { createMessage } = require('@alexify/mailer');

const message = createMessage({
  from: 'support@example.com',
  to: 'customer@example.com',
  subject: 'Ticket Update',
  content: { text: 'Your support ticket has been updated.' },
  tags: ['support', 'customer-service', 'urgent'],
});
```

## Custom headers

Sometimes you need to include custom email headers for specific functionality
or compliance requirements. You can add custom headers using the `headers` field
as a simple object, a standard [`Headers`] instance, or an `ImmutableHeaders`
instance (which is an immutable version compatible with the standard
[`Headers`] interface):

```js
const { createMessage } = require('@alexify/mailer');

// Using a simple object
const message1 = createMessage({
  from: 'app@example.com',
  to: 'user@example.com',
  subject: 'Password Reset',
  content: { text: 'Click the link to reset your password.' },
  headers: {
    'X-Mailer': 'mailer Email Library',
    'X-Priority': '1',
    'List-Unsubscribe': '<mailto:unsubscribe@example.com>',
  },
});
```

```js
// Using standard Headers object
const headers = new Headers();
headers.set('X-Mailer', 'mailer Email Library');
headers.set('X-Priority', '1');

const message2 = createMessage({
  from: 'app@example.com',
  to: 'user@example.com',
  subject: 'Password Reset',
  content: { text: 'Click the link to reset your password.' },
  headers,
});
```

The `createMessage()` function handles all the complexity of email message
construction, ensuring that your messages are properly formatted and valid
before sending them through your chosen transport.

`Headers` keeps names in lower case, so a transport that composes the message
writes each custom field name capitalized, as nodemailer does: `X-Custom-Header`,
with `MIME`, `DKIM`, `ARC` and `BIMI` at the start and `-ID`, `-SPF`, `-FBL` and
`-MD5` at the end upper-cased (`X-Entity-Ref-ID`, `Received-SPF`), and `X-SMTPAPI`
as SendGrid spells it.

[`Headers`]: https://developer.mozilla.org/en-US/docs/Web/API/Headers

### Headers the transport owns

A few header fields come from the message itself rather than from `headers`, so
a transport that composes the message ignores custom headers that would collide
with them: `From`, `To`, `Cc`, `Bcc`, `Reply-To`, `Subject`, `MIME-Version`,
`Content-Type`, and `Content-Transfer-Encoding`.  Use the corresponding
`createMessage()` fields to set those.  Note that `Bcc` in particular is carried
in the envelope and never written into the message, so blind recipients stay
hidden from everyone who receives it.

`Date`, `Message-ID`, `In-Reply-To`, and `References` have dedicated fields too,
described in the next section.  They differ from the fields above in that a
custom header is still honored when the dedicated field is left unset, so the
header form keeps working.

## Scheduling, tracking and metadata

Three fields ask the provider for what only some providers do:

```js
const message = createMessage({
  from: 'shop@example.com',
  to: 'customer@example.com',
  subject: 'Your order has shipped',
  content: { html: '<p>…</p>' },
  scheduledAt: new Date('2026-10-18T09:00:00Z'),
  tracking: { opens: false, clicks: true },
  metadata: { orderId: '42', tenant: 'acme' },
});
```

- `scheduledAt` is when the provider should deliver the message.  A transport
  that cannot schedule it, SMTP and JMAP among them, refuses the message with a
  non-retryable `unsupported` receipt rather than sending it at once, so `./pool`
  fails over to a transport that can schedule and `./retry` does not retry it.
- `tracking` turns open and click tracking on or off for this message, over the
  configuration of the transport, where the provider takes it per message.
- `metadata` holds values the provider keeps with the message and returns in its
  events.  A key is 1 to 128 letters, digits, `_`, `-` or `.`, since it may become
  the name of a header or form field; a value is a string of at most 1024
  characters without control characters; and there are at most 64 keys.  Each
  provider has tighter limits of its own (Postmark 10 fields of 80 characters).

SMTP and JMAP ignore `tracking` and `metadata`, which have no meaning in the
message itself.  Each provider's page says which of the three it takes.

## Mailing lists and one-click unsubscribe

The `list` field writes the List-* header fields of [RFC 2369] and [RFC 2919],
which mail clients use to show an unsubscribe button, and, with `oneClick`, the
`List-Unsubscribe-Post` field of [RFC 8058] that Gmail and Yahoo ask of bulk
senders:

```js
const message = createMessage({
  from: 'news@example.com',
  to: 'reader@example.com',
  subject: 'This week',
  content: { html: '<p>…</p>' },
  list: {
    id: { id: 'news.example.com', name: 'Weekly News' },
    unsubscribe: ['https://example.com/unsubscribe?u=42', 'unsubscribe@example.com'],
    oneClick: true,
  },
});
// List-ID: Weekly News <news.example.com>
// List-Unsubscribe: <https://example.com/unsubscribe?u=42>,
//  <mailto:unsubscribe@example.com>
// List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

`help`, `unsubscribe`, `subscribe`, `post`, `owner` and `archive` each take one
URL or several, which go into one field: an `http:`, `https:` or `mailto:` URL,
or a bare address for a `mailto:` one.  An entry may be `{ url, comment }`, with
a comment of printable ASCII.  `id` is a dot-atom with a namespace, with an
optional `name`.  A URL with whitespace, a control character or an angle bracket,
a URL of another scheme or without one, and an unknown key are refused with a
`TypeError`, never stripped or guessed.

Set `oneClick: true` only when a POST to the https URL of `unsubscribe`
unsubscribes at once, without a page to confirm; it needs such a URL.  RFC 8058
also asks for a DKIM signature over both fields, which the default signature of
`./mime` and `./smtp` gives.  The fields go into `Message.headers`, so every
transport that sends custom header fields sends them; a field given in `list`
may not also be given in `headers`.

[RFC 2369]: https://www.rfc-editor.org/rfc/rfc2369
[RFC 2919]: https://www.rfc-editor.org/rfc/rfc2919
[RFC 8058]: https://www.rfc-editor.org/rfc/rfc8058

## Message identity and reply threading

Applications that correlate replies, such as a helpdesk matching an incoming
answer back to a ticket, need to choose the outgoing message identifier rather
than discover it afterwards.  `createMessage()` takes four fields for that:

- `messageId`: The RFC 5322 message identifier.  The enclosing angle brackets are
  optional and stripped, so `<abc@example.com>` and `abc@example.com` mean
  the same thing.

- `date`: The origination date.  With neither this nor a custom `Date` header set, a
  transport that composes the message uses the time of conversion, so a retry
  carries a later date.

- `inReplyTo`: The identifier, or identifiers, of the messages this one replies to.

- `references`: The identifiers of the conversation, oldest first.  A reply usually carries
  the parent's references followed by the parent's own identifier, which is
  how a mail client reconstructs a thread.

Mint an identifier with `generateMessageId()` before sending, store it with
whatever the message is about, and the value survives conversion and any
delivery retry, because a retry re-sends the very same message:

```js
const { createMessage, generateMessageId } = require('@alexify/mailer');

const messageId = generateMessageId('example.com');
await storeTicketMessageId(messageId);

const message = createMessage({
  from: 'support@example.com',
  to: 'customer@example.net',
  subject: 'Re: Your request',
  content: { text: 'Thanks for getting in touch.' },
  messageId,
  date: new Date('2026-09-01T10:00:00Z'),
});
```

When the customer answers, their reply carries `In-Reply-To: <that identifier>`,
which is what ties the answer back to the ticket.  Composing the next message in
the thread is the mirror image:

```js
const { createMessage } = require('@alexify/mailer');

const reply = createMessage({
  from: 'support@example.com',
  to: 'customer@example.net',
  subject: 'Re: Your request',
  content: { text: 'Here is the answer.' },
  inReplyTo: inbound.messageId,
  references: [...inbound.references, inbound.messageId],
});
```

An identifier that is not valid is rejected rather than repaired, since these
fields are written into the message as given:

```js
const { createMessage } = require('@alexify/mailer');

try {
  createMessage({
    from: 'support@example.com',
    to: 'customer@example.net',
    subject: 'Re: Your request',
    content: { text: 'Thanks for getting in touch.' },
    messageId: 'not an identifier',
  });
} catch (error) {
  console.error(error); // TypeError: Invalid message ID: "not an identifier"
}
```

`parseMessageId()` normalizes a single identifier and returns `undefined`
instead of throwing, which is convenient for values arriving from elsewhere.
It parses one identifier, so an `In-Reply-To` field carrying several has to be
split first.

### Identifiers of your own

The identifiers the library generates are random UUIDs: the left half of a
Message-ID, the Content-ID of a `File` attachment, an idempotency key, and the
message ID of a receipt a provider gave none for. Pass `generateId` to make them
the way your records do, such as a ULID, a cuid2 or a nanoid, or to make them
deterministic in tests. It is told the kind of identifier it makes
(`message-id`, `content-id`, `idempotency-key` or `receipt-id`), returns the
left half only of a Message-ID or a Content-ID, and what it returns is checked:
dot-atom-text for those two kinds, and printable ASCII without spaces, at most
256 characters, for every kind.

```js
const { ulid } = require('ulid');
const { createMessage, generateMessageId } = require('@alexify/mailer');
const { SmtpTransport } = require('@alexify/mailer/smtp');

const generateId = () => ulid();

const messageId = generateMessageId('example.com', { generateId });
// "01JA7Y9Q3V2N8K4T6W0X1C5B2M@example.com"
const message = createMessage({ ...fields, messageId }, { generateId });
const transport = new SmtpTransport({ host: 'smtp.example.com', generateId });
```

`composeMessage()` of `./mime` takes `generateId` in its options too, and every
transport in its configuration.

### Dropping an inherited header

`inReplyTo` and `references` distinguish three states, which matters when a
message is assembled from a template that already carries these headers:

 -  Leaving the field unset defers to a custom `In-Reply-To` or `References`
    header.
 -  Setting it to a non-empty array replaces that header.
 -  Setting it to an empty array suppresses the header, so the message
    deliberately starts a new thread.

### Transport support

`Message-ID` and `Date` are only as durable as the transport carrying them.  A
provider that composes the message on its own side may assign or rewrite both,
whatever the message asked for.

| Transport          | `Message-ID` and `Date` | `In-Reply-To` and `References` |
| ------------------ | ----------------------- | ------------------------------ |
| *@alexify/mailer/smtp*       | Written as given        | Written as given               |
| *@alexify/mailer/jmap*       | Written as given        | Written as given               |
| *@alexify/mailer/mailgun*    | Not sent                | Sent as a custom header        |
| *@alexify/mailer/sendgrid*   | Not sent                | Sent as a custom header        |
| *@alexify/mailer/mailtrap*   | Not sent                | Sent as a custom header        |
| *@alexify/mailer/maileroo*   | Not sent                | Sent as a custom header        |
| *@alexify/mailer/lettermint* | Not sent                | Sent as a custom header        |
| *@alexify/mailer/resend*     | Not sent                | Sent as a custom header        |
| *@alexify/mailer/plunk*      | Not sent                | Sent as a custom header        |
| *@alexify/mailer/ses*        | Not sent                | Not sent                       |

“Not sent” describes @alexify/mailer, not the provider.  Most of these APIs accept a
custom `Message-ID` without documenting whether the value survives their
pipeline; Lettermint documents that it replaces one unless a separate opt-in
header accompanies it, and Amazon SES documents that it overrides both fields
even for a raw MIME message.  Rather than promise preservation @alexify/mailer cannot
verify, those transports leave the fields alone.  *@alexify/mailer/ses* sends no custom
headers at all.

Providers also cap header values well below the length a long thread produces:
768 characters for Maileroo, around 995 for Plunk and Amazon SES.  @alexify/mailer does not
truncate a `References` chain, so an over-long one surfaces as a provider error.

> [!NOTE]
> A message identifier supports *correlation*.  It is not a capability, so
> receiving one proves nothing about who sent it; it does not deduplicate
> anything, nor make delivery exactly-once; and a recipient's mail client may
> thread by subject regardless.

### `Message-ID` is not `Receipt.messageId`

The `messageId` on a successful `Receipt` is the delivery handle the transport
or the provider reports back: an SMTP queue identifier, a provider UUID, a JMAP
submission id.  It is chosen by the far side, differs in shape between
transports, and is not the RFC 5322 `Message-ID` the message carries.  Use it to
look a delivery up in a provider's dashboard; use `message.messageId` to
correlate a reply.

