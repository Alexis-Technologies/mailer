# Firebase Cloud Messaging

`@alexify/mailer/fcm` sends push notifications to Android, iOS and the web
through [FCM HTTP v1](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages),
with a service account of the Firebase project.

```js
const { FcmTransport } = require('@alexify/mailer/fcm');
const { createChannelMessage } = require('@alexify/mailer/channels');

const fcm = new FcmTransport({
  // The JSON of a service account with the role Firebase Cloud Messaging API Admin.
  serviceAccount: JSON.parse(process.env.FCM_SERVICE_ACCOUNT),
});

await fcm.send(
  createChannelMessage({
    channel: 'push',
    to: { token: device.fcmToken }, // or { topic: 'news' }
    title: 'Your order shipped',
    text: `Order ${order.number} is on its way.`,
    data: { orderId: order.id },
    priority: 'high',
    expiresAt: new Date(Date.now() + 60 * 60_000),
  }),
);
// { successful: true, messageId: 'projects/shop-app/messages/0:1700…',
//   provider: 'fcm', channel: 'push', state: 'sent' }
```

The token of the service account is asked for once, held until five minutes
before its end and shared by every send; one FCM refuses with a 401 is dropped,
and the next send asks for another. A new token that cannot be made while the
held one still serves is a process warning, `MAILER_TOKEN_REFRESH_FAILED`, at
most ten a minute, so the failure is heard before the sends fail. The `token_uri` of the account's JSON is
not followed: a file of credentials does not choose where its signed assertion
goes.

## What goes

| Message | `message` of `messages:send` |
| --- | --- |
| `to` | `token`, or `topic` |
| `title`, `text` | `notification.title`, `notification.body` |
| `media` | one picture at its URL, `notification.image` |
| `data` | `data`, its strings as they are |
| `priority` | `high`: Android's `HIGH`, `apns-priority: 10`, `Urgency: high`; `low`: `NORMAL`, `5`, `low` |
| `expiresAt` | Android's `ttl`, `apns-expiration`, the `TTL` of Web Push (four weeks at most) |
| `payload` | the fields of the message over those, merged key by key: `android.notification`, `apns.payload`, `webpush`, `fcm_options` |

Refused before any request: a key of `data` FCM keeps for itself (`from`,
`notification`, `message_type`, or one starting with `google.` or `gcm.`), a
subscription of Web Push (which [`./webpush`](/channels/webpush) sends), buttons,
more than one picture or a picture as bytes, and a payload that sets the target.

## Receipts

The receipt says `state: 'sent'`: FCM took the message, which tells nothing of
the device. Its id is the `name` FCM gives the message.

| Error | Category |
| --- | --- |
| `UNREGISTERED`, a token that is no token of FCM | `unregistered`: drop the token |
| `SENDER_ID_MISMATCH` | `invalid-recipient`: a token of another project |
| `QUOTA_EXCEEDED`, `RESOURCE_EXHAUSTED` | `rate-limit`, retried after its `Retry-After` |
| `UNAVAILABLE` | `service-unavailable`, retried |
| `INTERNAL` | `server-error`, retried |
| `THIRD_PARTY_AUTH_ERROR` | `configuration`: the APNs key or the web credentials of the project |
| `UNAUTHENTICATED`, `PERMISSION_DENIED`, a token Google refused | `auth` |
| `INVALID_ARGUMENT` | `validation` |

An error is told by the `errorCode` of its FcmError first, then by its status.
`messages:send` has no idempotency key: a send whose answer was lost (a
timeout, a reset) is never retried, and its receipt is `deliveryUnknown`.

`verify()` makes a dry run (`validate_only`) to a topic, which FCM checks and
does not send.
