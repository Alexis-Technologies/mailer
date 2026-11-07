# Router

`@alexify/mailer/router` makes one transport of several: each message goes
through the transport of its `channel`, and a message without one is an email
message, as 1.x made them. It is what a worker of a queue that holds messages
of several channels is given.

```js
const { createRouter } = require('@alexify/mailer/router');
const { SesTransport } = require('@alexify/mailer/ses');

const transport = createRouter({
  email: new SesTransport({ authentication, region: 'eu-west-1' }),
  sms: twilio,
  telegram,
});

await transport.send(createMessage({ from, to, subject, content })); // through SES
await transport.send(createChannelMessage({ channel: 'sms', to: '+380671234567', text: 'Hi' }));
```

- **A channel without a route** fails as `unsupported`, not retried, the receipt
  naming its `channel` and the provider `router`.
- **`sendMany`** gives the messages of one channel that come in a row to the
  `sendMany` of its transport, so a batch API sees them together, and the
  receipts come in the order of the messages. A caller who stops reading closes
  the input.
- **`sendRaw`** goes through the transport of email, and fails as
  `unsupported` without one, as `configuration` when it sends no raw message.
- **`verify`** verifies the transport of each channel that can verify: the
  router is ready only when each is, and it fails with an `AggregateError` of
  each that did not.
- **Disposing of the router** disposes of each transport once, a transport given
  for two channels included, whichever fails.

The routes are typed: `createRouter({ sms: twilio })` takes the messages of SMS
alone, a transport of email is no route of SMS, and the receipts name the
providers of the routes.

A router is no fallback: a message that fails on its channel is not sent on
another. The fallback from one channel to another, on the outcome of a
message, comes with 2.1.
