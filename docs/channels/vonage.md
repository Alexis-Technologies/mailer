# Vonage

`@alexify/mailer/vonage` sends SMS through the
[SMS API](https://developer.vonage.com/en/messaging/sms/overview) of Vonage
(`/sms/json`).

```js
const { VonageTransport } = require('@alexify/mailer/vonage');
const { createChannelMessage } = require('@alexify/mailer/channels');

const vonage = new VonageTransport({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
  from: 'MyBrand',
  callback: 'https://example.com/webhooks/vonage', // the delivery receipts
});

await vonage.send(
  createChannelMessage({
    channel: 'sms',
    to: '+380671234567',
    text: `Ваш код ${code}`, // sent as unicode, UCS-2
    metadata: { correlationId: login.id },
  }),
);
// { successful: true, messageId: '…', provider: 'vonage', channel: 'sms',
//   state: 'accepted', segments: 1 }
```

## What goes

| Message | Form |
| --- | --- |
| `to` | `to`, the number without `+` |
| `from`, or none | `from`, else the transport's |
| `text` | `text`, as `type: unicode` when it is no text of GSM-7 |
| `expiresAt` | `ttl`, twenty seconds to a week |
| `metadata.correlationId` | `client-ref`, 40 characters at most, which the receipts give back |
| `payload` | the fields of the form over those (`message-class`, `status-report-req`), but the credentials, the number and the text |

Media, buttons and a text of more than 3200 characters are refused before any
request.

## Receipts

Vonage answers each part of a message in a 200 with its own status, and every
part is read: the receipt says `state: 'accepted'`, the id of the first part
its id and the `message-count` its segments. A refused part fails the message
by its status; when an earlier part went, the receipt is of unknown delivery,
as the recipient may hold it.

| Status | Category |
| --- | --- |
| 6 unroutable, 33 deactivated | `invalid-recipient` |
| 7 a number barred | `opted-out` |
| 1 throttled, 10 too many binds | `rate-limit`, retried |
| 5 an internal error | `server-error`, retried |
| 4, 14, 32 credentials or signature | `auth` |
| 8, 9, 11, 15, 23, 29 (an account barred, a quota, a sender, a trial) | `configuration` |
| 2, 3, 12, 22, another | `validation` |

The SMS API takes no idempotency key: a send whose answer was lost is never
retried, and its receipt is `deliveryUnknown`.

`verify()` reads the balance of the account, with Basic credentials rather
than the secret in the query of a URL.
