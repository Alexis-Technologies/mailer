# Twilio

`@alexify/mailer/twilio` sends SMS, MMS, WhatsApp and RCS through the
[Messages API](https://www.twilio.com/docs/messaging/api/message-resource) of
Twilio, one request for each channel by the prefix of its recipient.

```js
const { TwilioTransport } = require('@alexify/mailer/twilio');
const { createChannelMessage } = require('@alexify/mailer/channels');

const twilio = new TwilioTransport({
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN, // or apiKey: { sid, secret }
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  statusCallback: 'https://example.com/webhooks/twilio',
});

const receipt = await twilio.send(
  createChannelMessage(
    {
      channel: 'sms',
      to: '067 123 45 67',
      text: `Your code is ${code}`,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      metadata: { correlationId: login.id },
    },
    { defaultCountry: 'UA' },
  ),
);
// { successful: true, messageId: 'SM…', provider: 'twilio', channel: 'sms',
//   state: 'accepted', segments: 1 }
```

`accepted` is where the receipt stops: Twilio tells the delivery to the
`statusCallback`, and 2.0 has no verifier of that callback yet (it comes with the
webhooks of the channels in 2.1). Until then, check its `X-Twilio-Signature` in
your handler before you trust what it says, as an unsigned callback can be posted
by anyone who knows its URL.

## What goes

| Message                  | Form                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `to`                     | `To`, prefixed `whatsapp:` or `rcs:` for those channels                                                                       |
| `from`, or none          | `From` (its channel's prefix), else the sender of the channel (`from`, `whatsappFrom`, `rcsFrom`), else `MessagingServiceSid` |
| `text`                   | `Body`, 1600 characters at most                                                                                               |
| `media`                  | `MediaUrl` of an MMS, ten URLs at most                                                                                        |
| `template`               | `ContentSid` (`HX…`) of a template of the Content API, the first of its `components` the `ContentVariables`                   |
| `expiresAt`              | `ValidityPeriod`, ten hours at most                                                                                           |
| `metadata.correlationId` | in the query of `StatusCallback`, which the signature of a callback covers                                                    |
| `payload`                | the fields of the form over those (`ShortenUrls`, `SmartEncoded`, `ContentRetention`), but `To`, `From` and `Body`            |

Buttons (a template of the Content API carries them) and media as bytes are
refused before any request.

## Region and edge

Messages are processed in `us1` by default; `region: 'ie1'` or `'au1'` with
its `edge` (`dublin`, `sydney`) sends them to that region's host, both taken
from Twilio's closed lists, as they are written into the host the credentials
go to.

## Receipts

Twilio queues a message and tells its delivery to the status callback: a
receipt says `state: 'accepted'`, its id the sid of the message, and its
`segments` the `num_segments` Twilio counted.

| Code                                     | Category               |
| ---------------------------------------- | ---------------------- |
| 21610, the recipient sent STOP           | `opted-out`            |
| 21211, 21601, 21614, 30005, 30006        | `invalid-recipient`    |
| 30003, 30008                             | `unreachable`, retried |
| 63003, a recipient not on WhatsApp       | `not-on-channel`       |
| 63016, outside the window of WhatsApp    | `outside-window`       |
| 30004                                    | `blocked`              |
| 30007, filtered by the carrier           | `rejected`             |
| 20003                                    | `auth`                 |
| 21408, 21606, 21612, 21212, 21659, 20404 | `configuration`        |
| 21602, 21617, 21620, 21623               | `validation`           |
| 20429, 14107, 30022                      | `rate-limit`, retried  |

The Messages API takes no idempotency key: a send whose answer was lost, or was
a 500 or a 502, is never retried, and its receipt is `deliveryUnknown`.

`verify()` reads the account.
