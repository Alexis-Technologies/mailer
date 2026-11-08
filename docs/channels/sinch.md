# Sinch

`@alexify/mailer/sinch` sends SMS through the
[SMS API](https://developers.sinch.com/docs/sms/api-reference/) of Sinch, a
batch of one recipient each (`/xms/v1/<servicePlanId>/batches`), with the API
token of the service plan.

```js
const { SinchTransport } = require('@alexify/mailer/sinch');
const { createChannelMessage } = require('@alexify/mailer/channels');

const sinch = new SinchTransport({
  servicePlanId: process.env.SINCH_SERVICE_PLAN_ID,
  apiToken: process.env.SINCH_API_TOKEN,
  region: 'eu', // us, eu, au, br or ca: the host of the account
  from: 'MyBrand',
  callbackUrl: 'https://example.com/webhooks/sinch', // reports per recipient
});

await sinch.send(
  createChannelMessage({
    channel: 'sms',
    to: '+380671234567',
    text: `Your code is ${code}`,
    expiresAt: new Date(Date.now() + 10 * 60_000),
    metadata: { correlationId: login.id },
  }),
);
// { successful: true, messageId: '01F…', provider: 'sinch', channel: 'sms',
//   state: 'accepted', segments: 1 }
```

`region` is taken from Sinch's closed list, as it is written into the host the
token goes to.

## What goes

| Message                  | Batch                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `to`                     | `to`, the number without `+`                                                                             |
| `from`, or none          | `from`, else the transport's, else the default originator of the plan                                    |
| `text`                   | `body`, 2000 characters at most                                                                          |
| `expiresAt`              | `expire_at`, when it is sooner than the three days Sinch keeps a batch                                   |
| `metadata.correlationId` | `client_reference`, which the delivery reports give back                                                 |
| `payload`                | the fields of the batch over those (`flash_message`, `max_number_of_message_parts`), but `to` and `body` |

The transport's `callbackUrl` is the `callback_url` of each batch, with
`delivery_report: 'per_recipient'` unless `deliveryReport` says otherwise.
Media and buttons are refused before any request.

## Receipts

Sinch queues a batch and tells its delivery to the callback: a receipt says
`state: 'accepted'`, the id of the batch its id, and the segments
`countSegments` of [`./channels`](/channels/messages) counts, as Sinch tells
none in its answer.

| Error                                      | Category                |
| ------------------------------------------ | ----------------------- |
| `invalid_recipient`, `invalid_destination` | `invalid-recipient`     |
| 401                                        | `auth`                  |
| 403, 404, `unprovisioned_region`           | `configuration`         |
| 429                                        | `rate-limit`, retried   |
| 5xx                                        | `server-error`, retried |
| another 400                                | `validation`            |

The batches API takes no idempotency key: a send whose answer was lost is
never retried, and its receipt is `deliveryUnknown`.

`verify()` lists one batch of the plan, which sends nothing.
