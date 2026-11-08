# APNs

`@alexify/mailer/apns` sends pushes to the devices of Apple through the
[Apple Push Notification service](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns),
over one HTTP/2 session of its origin (`node:http2`; Node's `fetch` speaks
HTTP/1.1, which APNs refuses), with the token authentication of a team.

```js
const { ApnsTransport } = require('@alexify/mailer/apns');
const { createChannelMessage } = require('@alexify/mailer/channels');

const apns = new ApnsTransport({
  teamId: 'ABCDE12345',
  keyId: 'KEY1234567',
  privateKey: process.env.APNS_KEY, // the .p8 of a key of Apple Push Notifications
  topic: 'com.example.app', // the bundle id
  environment: 'production', // or 'sandbox' for a build of Xcode
});

await apns.send(
  createChannelMessage({
    channel: 'push',
    to: { token: device.token },
    title: 'Shipped',
    text: 'Order A-1 is on its way',
    data: { orderId: 'A-1' },
  }),
);
// { successful: true, messageId: '8a4c5b2e-…', provider: 'apns',
//   channel: 'push', state: 'sent' }

await apns[Symbol.asyncDispose](); // closes the session
```

`environment` is required and never read from `NODE_ENV`: the token of a
device is of one environment, and the other refuses it. The session is held
by the process only while a push is out on it, so a script ends without
disposing of the transport.

## What goes

| Message           | APNs                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------- |
| `to.token`        | the path, `/3/device/<token>`; a topic or a subscription of Web Push is refused         |
| `title`, `text`   | `aps.alert.title`, `aps.alert.body`                                                     |
| `data`            | keys at the root of the payload, beside `aps`                                           |
| `priority`        | `apns-priority`: `high` 10, `low` 5                                                     |
| `expiresAt`       | `apns-expiration`                                                                       |
| `idempotencyKey`  | `apns-id`, a UUID of the key (a random one without)                                     |
| `payload.headers` | header fields of APNs (`apns-push-type`, `apns-collapse-id`, `apns-topic`…)             |
| `payload.payload` | the JSON over the payload, merged key by key (`aps.sound`, `aps.badge`, `aps.category`) |

The payload has the shape of `apns` of FCM, headers and payload. A push that
holds no alert, badge or sound is of type `background`, with
`content-available: 1` and priority 5, as Apple asks; others are `alert`. A
payload over 4 KB (5 KB for VoIP), media (a notification service extension
fetches them) and buttons (the actions of an `aps.category`) are refused
before any request.

## The token of the team

The JWT of the team is signed once for 55 minutes and shared by the sends,
however many wait for it: APNs refuses a token changed within 20 minutes
(`TooManyProviderTokenUpdates`). A token APNs says expired is dropped and the
push sent once more with a new one.

## Receipts

The receipt says `state: 'sent'`, as APNs tells no delivery, its id the
`apns-id`.

| Reason                                                                                    | Category                       |
| ----------------------------------------------------------------------------------------- | ------------------------------ |
| `Unregistered`, `ExpiredToken` (410)                                                      | `unregistered`: drop the token |
| `BadDeviceToken`, `DeviceTokenNotForTopic`                                                | `invalid-recipient`            |
| `BadTopic`, `TopicDisallowed`, `BadCertificateEnvironment`, `TooManyProviderTokenUpdates` | `configuration`                |
| `InvalidProviderToken`, `ExpiredProviderToken`, `MissingProviderToken`                    | `auth`                         |
| `TooManyRequests`                                                                         | `rate-limit`, retried          |
| `PayloadTooLarge`, another 400                                                            | `validation`                   |

A 5xx, a timeout or a lost answer may come after APNs took the push: its
receipt is `deliveryUnknown`, never retried. APNs has no request that checks
a key without sending, so the transport has no `verify()`.
