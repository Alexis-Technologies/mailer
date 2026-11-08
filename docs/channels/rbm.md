# RCS Business Messaging

`@alexify/mailer/rbm` sends messages of RCS from an agent through Google's
[RCS Business Messaging API](https://developers.google.com/business-communications/rcs-business-messaging)
(`phones.agentMessages.create`), with the token of the agent's service
account, asked for once and shared, as [`./fcm`](/channels/fcm) shares its.

```js
const { RbmTransport } = require('@alexify/mailer/rbm');
const { createChannelMessage } = require('@alexify/mailer/channels');

const rbm = new RbmTransport({
  serviceAccount: JSON.parse(process.env.RBM_SERVICE_ACCOUNT),
  agentId: 'shop_agent',
  region: 'europe', // global, europe or asia
});

await rbm.send(
  createChannelMessage({
    channel: 'rcs',
    to: '+380671234567',
    text: 'Your order shipped',
    media: [{ url: 'https://example.com/parcel.png' }],
    buttons: [{ type: 'url', text: 'Track', url: 'https://example.com/track/A-1' }],
    idempotencyKey: `shipped:${order.id}`,
  }),
);
// { successful: true, messageId: '…', provider: 'rbm', channel: 'rcs',
//   state: 'accepted' }
```

## What goes

| Message           | AgentMessage                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`            | `contentMessage.text`, 3072 characters at most                                                                                                          |
| one medium by URL | `contentMessage.contentInfo.fileUrl`; with a text, a standalone rich card, the text its description (2000 characters at most)                           |
| `buttons`         | suggestions, 11 at most (4 on a card), their text 25 characters: a `reply` with its id as postback, a `url` an `openUrlAction`, a `call` a `dialAction` |
| `expiresAt`       | `expireTime`                                                                                                                                            |
| `idempotencyKey`  | the `messageId`, a UUID of the key (a random one without)                                                                                               |
| `payload`         | the fields of the AgentMessage over those, merged key by key (`messageTrafficType`, `contentMessage.richCard`, `contentMessage.uploadedRbmFile`)        |

More than one medium, and a medium as bytes (upload it to RBM and pass its
`uploadedRbmFile` in the payload), are refused before any request.

## Receipts

The API takes a `messageId` once and refuses it again with `ALREADY_EXISTS`:
a send whose answer was lost, or a 5xx, is sent again under it, and an
`ALREADY_EXISTS` is of unknown delivery, as the first went. The receipt says
`state: 'accepted'`, its id the `messageId`; the delivery and the reading come
to the webhook of the agent.

| Status                                                                                 | Category                           |
| -------------------------------------------------------------------------------------- | ---------------------------------- |
| `NOT_FOUND`, a user without RCS or out of reach of the agent's carriers                | `not-on-channel`: fall back to SMS |
| `PERMISSION_DENIED`, an agent not launched for the carrier, or a device not a tester's | `configuration`                    |
| `UNAUTHENTICATED`                                                                      | `auth`, the token dropped          |
| `INVALID_ARGUMENT`                                                                     | `validation`                       |
| `RESOURCE_EXHAUSTED`                                                                   | `rate-limit`, retried              |
| `UNAVAILABLE`, `INTERNAL`                                                              | retried                            |

A user without RCS is refused by the send itself, so no capability check goes
before it: it would be a request more for each message, under a quota of its
own.
