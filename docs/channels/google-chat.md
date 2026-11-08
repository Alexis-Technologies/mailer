# Google Chat

`@alexify/mailer/google-chat` posts to Google Chat through
`spaces.messages.create` of the
[Chat API](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/create),
in two ways: to the space of a
[webhook](https://developers.google.com/workspace/chat/quickstart/webhooks),
whose URL (its key and token) is its credential, and to the spaces of a Chat
app, with the token of its service account.

```js
const { GoogleChatTransport } = require('@alexify/mailer/google-chat');
const { createChannelMessage } = require('@alexify/mailer/channels');

const chat = new GoogleChatTransport({
  webhookUrl: process.env.GOOGLE_CHAT_WEBHOOK_URL,
  serviceAccount: JSON.parse(process.env.GOOGLE_CHAT_SERVICE_ACCOUNT), // a Chat app
});

// To the space of the webhook: no `to`.
await chat.send(
  createChannelMessage({ channel: 'google-chat', text: 'Deployed *v1.2.3*', thread: 'deploy-42' }),
);

// To a space of the app.
await chat.send(
  createChannelMessage({
    channel: 'google-chat',
    to: 'spaces/AAAAxyz',
    text: 'Your report is ready',
    idempotencyKey: `report:${report.id}`,
  }),
);
// { successful: true, messageId: 'spaces/AAAAxyz/messages/…',
//   provider: 'google-chat', channel: 'google-chat', state: 'sent' }
```

## What goes

| Message                          | Message of Chat                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `text`                           | `text`, its mentions as below                                                        |
| one picture by URL, link buttons | a card (`cardsV2`) of an image and a button list                                     |
| `thread`                         | `thread.threadKey`, replying in the thread or starting it                            |
| `idempotencyKey` (an app)        | the `requestId`, a UUID of the key (a random one without)                            |
| `payload`                        | the fields of the message over those (`cardsV2`, `accessoryWidgets`, `fallbackText`) |

`<users/all>` notifies a whole space: it is broken with a zero-width space
unless `mentions.everyone`, and so is `<users/…>` of a user `mentions.users`
does not name. A reply or call button (an action is an app of its own), a
medium that is no picture, and a message over the 32,000 bytes of Chat are
refused before any request.

## Receipts

The receipt says `state: 'sent'`, the `name` of the message its id.

| Answer                                     | Category                  |
| ------------------------------------------ | ------------------------- |
| webhook: 401, 403, 404 (a webhook deleted) | `auth`                    |
| app: 404, a space it is not in             | `invalid-recipient`       |
| app: 403                                   | `configuration`           |
| app: 401                                   | `auth`, the token dropped |
| 429                                        | `rate-limit`, retried     |
| 400                                        | `validation`              |

The API answers a `requestId` again with the message it made under it: a
message of the app whose answer was lost is sent again under it. A webhook
takes no key: after a 5xx, a timeout or a lost answer its receipt is
`deliveryUnknown`, never retried.

`verify()` lists a space of the app; a webhook cannot be checked without
posting to it.
