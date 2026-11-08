# AlphaSMS

`@alexify/mailer/alphasms` sends SMS and Viber messages through the
[JSON API](https://docs.alphasms.ua/ru/api/json/) of AlphaSMS
(`api/json.php`), to a phone number, with the key of the account in the body
of each request.

```js
const { AlphaSmsTransport } = require('@alexify/mailer/alphasms');
const { createChannelMessage } = require('@alexify/mailer/channels');

const alphasms = new AlphaSmsTransport({
  apiKey: process.env.ALPHASMS_API_KEY,
  sender: 'MyBrand', // the alpha name, sms_signature
  hook: 'https://example.com/webhooks/alphasms', // the statuses
});

await alphasms.send(
  createChannelMessage({ channel: 'sms', to: '+380671234567', text: `Ваш код ${code}` }),
);
// { successful: true, messageId: '123456789', provider: 'alphasms',
//   channel: 'sms', state: 'accepted', segments: 1 }
```

## What goes

| Message                                    | Item of `data`                                                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `to`                                       | `phone`, the number without `+`                                                                                                   |
| `idempotencyKey`                           | `id`, a number of the key (a random one without), which the statuses give back                                                    |
| SMS: `from`, `text`, `expiresAt`           | `sms_signature`, `sms_message`, `sms_lifetime` (an hour to three days)                                                            |
| Viber: a text                              | `viber_type: 'text'`, `viber_message` (1000 characters at most)                                                                   |
| Viber: a picture alone                     | `viber_type: 'image'`, `viber_image`                                                                                              |
| Viber: a text and a link button            | `viber_type: 'text+link'`, `viber_link`, `viber_button`                                                                           |
| Viber: a text, a picture and a link button | `viber_type: 'text+image+link'` with `viber_image`, `viber_link`, `viber_button`                                                  |
| Viber: `from`, `expiresAt`                 | `viber_signature`, `viber_lifetime` (a minute to three days)                                                                      |
| `payload`                                  | the fields of the item over those, but `id` and `phone`: `type: 'viber+sms'` with `sms_message` makes a message of Viber a hybrid |

A message of Viber goes to a phone number in E.164. Media on an SMS, another
mix of Viber's fields, and a button that is no link are refused before any
request.

## Receipts

AlphaSMS answers a 200 whose `success`, then that of the item, fails the
message; as its errors carry no code, their words tell the category:
`Access denied` `auth`, an error in the alpha name or no money
`configuration`, a phone `invalid-recipient`, another `rejected`. The receipt
of one that went says `state: 'accepted'`, the `msg_id` its id and the
`parts` its segments.

The API takes no idempotency key: a send whose answer was lost is never
retried, and its receipt is `deliveryUnknown`.

`verify()` reads the balance of the account, whose refusal is in a 200 too.
