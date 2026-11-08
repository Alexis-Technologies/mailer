# SMS Club

`@alexify/mailer/smsclub` sends SMS through the
[JSON API](https://smsclub.mobi/api) of SMS Club (`/sms/send`), with the
token of the account.

```js
const { SmsClubTransport } = require('@alexify/mailer/smsclub');
const { createChannelMessage } = require('@alexify/mailer/channels');

const smsclub = new SmsClubTransport({
  token: process.env.SMSCLUB_TOKEN, // the profile of the account, "token"
  sender: 'MyBrand', // the alpha name, src_addr
});

await smsclub.send(
  createChannelMessage({ channel: 'sms', to: '+380671234567', text: `Ваш код ${code}` }),
);
// { successful: true, messageId: '106', provider: 'smsclub', channel: 'sms',
//   state: 'accepted', segments: 1 }
```

## What goes

| Message         | `/sms/send`                                                                        |
| --------------- | ---------------------------------------------------------------------------------- |
| `to`            | `phone`, the number without `+`                                                    |
| `from`, or none | `src_addr`, else the transport's `sender`                                          |
| `text`          | `message`                                                                          |
| `payload`       | the fields of the request over those (`integration_id`), but `phone` and `message` |

Media and buttons are refused before any request. SMS Club takes 9 requests a
second of a user; [`./ratelimit`](/transports/ratelimit) holds a transport
to it. Its Viber, which its JSON API does not document, is not sent.

## Receipts

The receipt says `state: 'accepted'`, its id the id of the SMS, the key of
the `info` of the answer, and its segments those
[`countSegments`](/channels/messages) counts. A refusal is told by its
status:

| Status                               | Category                |
| ------------------------------------ | ----------------------- |
| 400, a request it did not validate   | `validation`            |
| 401, the token                       | `auth`                  |
| 429, over 9 requests a second        | `rate-limit`, retried   |
| 453, the same SMS within two minutes | `rejected`              |
| 5xx                                  | `server-error`, retried |

An answer with no id but an `add_info` is a refusal. The API takes no
idempotency key: a send whose answer was lost is never retried, and its
receipt is `deliveryUnknown`. SMS Club tells the delivery only when asked
(`/sms/status`), which a later release reads.

`verify()` reads the balance of the account.
