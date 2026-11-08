# Web Push

`@alexify/mailer/webpush` sends push notifications to the subscriptions of
browsers through their push services ([RFC 8030](https://www.rfc-editor.org/rfc/rfc8030)),
each push encrypted for its subscription ([RFC 8291](https://www.rfc-editor.org/rfc/rfc8291))
and signed with the VAPID of the application ([RFC 8292](https://www.rfc-editor.org/rfc/rfc8292)),
on `node:crypto` alone.

```js
const { WebPushTransport } = require('@alexify/mailer/webpush');
const { createChannelMessage } = require('@alexify/mailer/channels');

const webpush = new WebPushTransport({
  // The pair whose public key the browser subscribed with (applicationServerKey).
  vapid: {
    subject: 'mailto:ops@example.com',
    publicKey: process.env.VAPID_PUBLIC_KEY, // 65 bytes, base64url
    privateKey: process.env.VAPID_PRIVATE_KEY, // 32 bytes, base64url
  },
});

await webpush.send(
  createChannelMessage({
    channel: 'push',
    to: subscription, // what PushManager.subscribe() gave: { endpoint, keys: { p256dh, auth } }
    title: 'Your order shipped',
    text: `Order ${order.number} is on its way.`,
    data: { url: `/orders/${order.id}` },
    payload: { topic: `order-${order.id}`, tag: 'orders' },
  }),
);
```

A pair of keys is made once, and its public key given to the browser:

```js
const { createECDH } = require('node:crypto');
const keys = createECDH('prime256v1');
keys.generateKeys();
console.log(keys.getPublicKey('base64url'), keys.getPrivateKey('base64url'));
```

## What the service worker reads

The push is one record of `aes128gcm` of this JSON, which a service worker
reads with `event.data.json()` and passes to `showNotification(title, options)`:

| JSON | Message |
| --- | --- |
| `title`, `body` | `title`, `text` |
| `image` | one picture at its URL |
| `data` | `data` |
| `actions` | the buttons: `{ action, title }`, and `url` for a link |
| any other | the fields of `payload` (`tag`, `icon`, `badge`, `requireInteraction`), but `topic` |

`payload.topic` is the `Topic` of the push: a push service keeps one push of a
topic not yet delivered, the last. `expiresAt` is its `TTL` (four weeks by
default, `ttl`), the priority its `Urgency`.

Refused before any request: a push of more than 3993 bytes of JSON, the most a
body of 4096 bytes carries; a topic that is not 1 to 32 characters of
base64url; buttons that call a phone; more than one picture, or one as bytes; a
token or a topic of FCM, which [`./fcm`](/channels/fcm) sends.

## The endpoint

A subscription comes from a browser and may name any host. A push goes only to
an `https:` endpoint whose host resolves to public addresses: a subscription of
`https://127.0.0.1/`, of a private network or of the metadata of a cloud is
refused as `invalid-recipient`, nothing sent. `allowEndpoint(url)` replaces the
check, such as for a push service of your own network. A name that answers the
request otherwise than it answered the check (DNS rebinding) is caught only by a
`fetch` that checks the address it connects to.

## Receipts

The receipt says `state: 'sent'`: the push service took the push. Its id is
the `Location` the service gives the message, or `webpush:<id>` of
`generateId` when it names none.

| Answer | Category |
| --- | --- |
| 404, 410 | `unregistered`: drop the subscription |
| 413, 400 | `validation` |
| 401, 403 | `auth`: the VAPID keys are not those the browser subscribed with |
| 429 | `rate-limit`, retried after its `Retry-After` |
| an endpoint refused, keys that are not of P-256 | `invalid-recipient` |

A push whose answer was lost (a timeout, a reset) is never sent again: its
receipt is `deliveryUnknown`. The VAPID keys are checked when the transport is
made (the curve, the pair, the subject), and a JWT is held per origin of a push
service for twelve hours.
