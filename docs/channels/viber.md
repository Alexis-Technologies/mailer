# Viber

`@alexify/mailer/viber` sends the messages of a bot of Viber through its
[REST Bot API](https://developers.viber.com/docs/api/rest-bot-api/)
(`/pa/send_message`), to the id of a user subscribed to the bot.

```js
const { ViberTransport } = require('@alexify/mailer/viber');
const { createChannelMessage } = require('@alexify/mailer/channels');

const viber = new ViberTransport({
  authToken: process.env.VIBER_AUTH_TOKEN,
  sender: { name: 'Shop', avatar: 'https://example.com/avatar.png' },
});

await viber.send(
  createChannelMessage({
    channel: 'viber',
    to: user.viberId, // the id the bot's webhook gave, such as '01234567890A='
    text: 'Your order shipped',
    buttons: [{ type: 'url', text: 'Track', url: 'https://example.com/track/A-1' }],
    metadata: { correlationId: order.id },
  }),
);
// { successful: true, messageId: '5741311803571721087', provider: 'viber',
//   channel: 'viber', state: 'accepted' }
```

A bot writes only to users who subscribed to it, or wrote to it first; their
ids come to its webhook.

## What goes

| Message                  | `send_message`                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to`                     | `receiver`                                                                                                                                                     |
| `from`, or none          | `sender.name` (28 characters at most), else the transport's                                                                                                    |
| `text`                   | a `text` message, 7000 characters at most                                                                                                                      |
| one picture by URL       | a `picture` message, the text its description (768 characters at most)                                                                                         |
| `buttons`                | a `keyboard`: a link `open-url`, a reply `reply` with its id, 24 at most                                                                                       |
| `metadata.correlationId` | `tracking_data`                                                                                                                                                |
| `payload`                | the fields of the request over those (`min_api_version`, `rich_media`, a `type` of `video` or `file` with its `media`, `size` and `file_name`), but `receiver` |

A medium that is no picture, more than one, and a call button are refused
before any request.

## Receipts

Viber answers a 200 whose `status` says whether the message went. The
receipt of a message that went says `state: 'accepted'`, its id the
`message_token`, a 64-bit integer read from the text of the answer as a
string, as a number of JavaScript would lose its last digits; the delivery and
the reading come to the webhook.

| Status                                                                         | Category                           |
| ------------------------------------------------------------------------------ | ---------------------------------- |
| 5 `receiverNotRegistered`, 6 `notSubscribed`, 11 `receiverNoSuitableDevice`    | `not-on-channel`: fall back to SMS |
| 2 `invalidAuthToken`                                                           | `auth`                             |
| 12 `tooManyRequests`                                                           | `rate-limit`, retried              |
| 1, 3, 4, 13, 14 (a URL, data, a version)                                       | `validation`                       |
| 7, 8, 9, 10, 15, 21, 23, 24 (the account blocked, suspended or out of balance) | `configuration`                    |
| another                                                                        | `rejected`                         |

The API takes no idempotency key: a send whose answer was lost is never
retried, and its receipt is `deliveryUnknown`.

`verify()` reads the account of the bot, whose refusal is a status in a 200
too.
