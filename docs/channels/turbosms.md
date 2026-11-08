# TurboSMS

`@alexify/mailer/turbosms` sends SMS and Viber messages through the
[HTTP API](https://turbosms.ua/api.html) of TurboSMS (`message/send.json`),
to a phone number, with the token of the account.

```js
const { TurboSmsTransport } = require('@alexify/mailer/turbosms');
const { createChannelMessage } = require('@alexify/mailer/channels');

const turbosms = new TurboSmsTransport({
  token: process.env.TURBOSMS_TOKEN,
  sender: 'MyBrand', // an alpha name active in the account
});

await turbosms.send(
  createChannelMessage({ channel: 'sms', to: '+380671234567', text: `Ваш код ${code}` }),
);
// { successful: true, messageId: 'f83f8868-…', provider: 'turbosms',
//   channel: 'sms', state: 'accepted', segments: 1 }

// Viber, sent as an SMS when Viber does not deliver it.
await turbosms.send(
  createChannelMessage({
    channel: 'viber',
    to: '+380671234567',
    text: 'Ваше замовлення відправлено',
    buttons: [{ type: 'url', text: 'Відстежити', url: 'https://example.com/t/A-1' }],
    payload: { sms: { text: 'Замовлення відправлено: example.com/t/A-1' } },
  }),
);
```

## What goes

| Message                              | `message/send`                                                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to`                                 | `recipients`, the number without `+`                                                                                                               |
| `from`, or none                      | `sender` of the `sms` or `viber` object, else `sender` (`viberSender` for Viber)                                                                   |
| `text` of an SMS                     | `sms.text`, 1521 characters of GSM-7 or 661 of UCS-2 at most, as TurboSMS takes                                                                    |
| `text` of Viber                      | `viber.text`, 1000 characters at most                                                                                                              |
| one picture, one link button (Viber) | `viber.image_url`; `viber.caption` (30 characters) and `viber.action`                                                                              |
| `expiresAt` (Viber)                  | `viber.ttl`, 30 seconds to a day                                                                                                                   |
| `payload`                            | the fields of the request over those: `sms` on a message of Viber makes it a hybrid, `start_time`, `is_flash`; never `recipients` or `sequence_id` |

A message of Viber goes to a phone number in E.164, not to the id of a bot's
user (that is [`./viber`](/channels/viber)). Media on an SMS, more than one
picture or button, and a button that is no link are refused before any
request.

## Receipts

Each send carries a `sequence_id` of its own, which TurboSMS executes once in
30 days and answers again with `FAILED_DUPLICATE_REQUEST` and the results of
the first: a request whose answer was lost, or that timed out, is sent again
under it, as TurboSMS asks that a send not be cut short. A later send of the
same message is a new request.

TurboSMS answers a 200 whose `response_code`, then that of the recipient,
fails the message; the receipt of one that went says `state: 'accepted'`, the
`message_id` its id.

| Code                                                                                                 | Category                                                                      |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 103, 105, 301 (the token)                                                                            | `auth`                                                                        |
| 106 (a user blocked), 203 (no balance), 302, 400, 401, 434 (the sender), 406 (a country not enabled) | `configuration`                                                               |
| 305, 318 (the phone)                                                                                 | `invalid-recipient`                                                           |
| 404, the stoplist                                                                                    | `opted-out`                                                                   |
| 427, the same message created within 90 seconds                                                      | of unknown delivery: it went then                                             |
| 428, 436, 437, 438 (limits)                                                                          | `rate-limit`, retried                                                         |
| 500, 501 (a request that ran, its answer not written)                                                | asked again under its `sequence_id`; of unknown delivery when no answer comes |
| 502 (a body it could not parse)                                                                      | `validation`                                                                  |
| 503, 504 (the SMS or Viber not sent)                                                                 | `server-error`, retried                                                       |
| another of 2xx to 4xx                                                                                | `validation`                                                                  |

`verify()` reads the balance of the account, whose refusal is a code in a
200 too. The delivery comes to the webhook of the account, which the webhooks
of a later release read.
