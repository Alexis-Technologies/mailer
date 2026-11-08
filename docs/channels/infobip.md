# Infobip

`@alexify/mailer/infobip` sends SMS through the SMS API of
[Infobip](https://www.infobip.com/docs/sms) (`/sms/3/messages`), with the key
of the account as `Authorization: App <key>`.

```js
const { InfobipTransport } = require('@alexify/mailer/infobip');
const { createChannelMessage } = require('@alexify/mailer/channels');

const infobip = new InfobipTransport({
  apiKey: process.env.INFOBIP_API_KEY,
  baseUrl: 'xyz123.api.infobip.com', // the host of the account
  from: 'MyBrand',
  notifyUrl: 'https://example.com/webhooks/infobip', // the delivery reports
});

await infobip.send(
  createChannelMessage({
    channel: 'sms',
    to: '+380671234567',
    text: `Your code is ${code}`,
    expiresAt: new Date(Date.now() + 10 * 60_000),
    metadata: { correlationId: login.id },
  }),
);
// { successful: true, messageId: '…', provider: 'infobip', channel: 'sms',
//   state: 'accepted', segments: 1 }
```

`baseUrl` is the host Infobip gives the account, which becomes an https URL,
or a URL; a host is held to a name of DNS labels, as the key goes to it, and
an error does not echo it.

## What goes

| Message                  | `messages[0]`                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `to`                     | `destinations[0].to`, the number without `+`                                                                                                           |
| `from`, or none          | `sender`, else the transport's, else the default of the account                                                                                        |
| `text`                   | `content.text`                                                                                                                                         |
| `expiresAt`              | `options.validityPeriod`, in minutes, a minute to 48 hours                                                                                             |
| `metadata.correlationId` | `webhooks.callbackData`, which the delivery reports give back                                                                                          |
| `payload`                | the fields of the message over those, objects merged one level down (`options.platform`, `content.transliteration`), but the destinations and the text |

The transport's `notifyUrl` is `webhooks.delivery.url`, with JSON reports.
Media and buttons are refused before any request. RCS through Infobip is not
sent by this transport yet.

## Receipts

Infobip answers the message with a status in its 200. One of the groups
REJECTED, UNDELIVERABLE or EXPIRED fails it by the words of its name;
otherwise the receipt says `state: 'accepted'`, the `messageId` its id and
the `messageCount` of the answer its segments (those `countSegments` counts
when the answer has none).

| Status                                                                                                         | Category                |
| -------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `REJECTED_DND`                                                                                                 | `opted-out`             |
| `REJECTED_DESTINATION`, `REJECTED_PREFIX_MISSING`, `MISSING_TO`                                                | `invalid-recipient`     |
| the sender or source, the credits, a prepaid package, a route or a network, a number not registered on a trial | `configuration`         |
| `REJECTED_FLOODING_FILTER`                                                                                     | `rate-limit`, retried   |
| `REJECTED_SYSTEM_ERROR`                                                                                        | `server-error`, retried |
| `REJECTED_MESSAGE_TOO_LONG`, `REJECTED_INVALID_UDH`                                                            | `validation`            |
| another                                                                                                        | `rejected`              |

An error answer is told by its status (401 `auth`, 403 `configuration`, 429
`rate-limit`), its `errorCode` the code of the receipt. The SMS API takes no
idempotency key: a send whose answer was lost is never retried, and its
receipt is `deliveryUnknown`.

`verify()` reads the balance of the account; a 403, which a key whose scopes
leave out the balance is answered, verifies it too.
