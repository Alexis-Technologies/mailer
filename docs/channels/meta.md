# WhatsApp, Messenger and Instagram

`@alexify/mailer/meta` sends the messages of Meta's three channels over one
client of its Graph API: WhatsApp through the
[Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api), Messenger
and Instagram through the
[Send API](https://developers.facebook.com/docs/messenger-platform/reference/send-api).
A transport has a block for each channel it sends, each with its token or the
shared one.

```js
const { MetaTransport } = require('@alexify/mailer/meta');
const { createChannelMessage } = require('@alexify/mailer/channels');

const meta = new MetaTransport({
  accessToken: process.env.META_SYSTEM_USER_TOKEN, // whatsapp_business_messaging
  whatsapp: { phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID },
  messenger: { pageId: process.env.PAGE_ID, accessToken: process.env.PAGE_TOKEN },
  instagram: { accountId: process.env.INSTAGRAM_ACCOUNT_ID },
  // graphVersion: 'v23.0' by default
});

// Outside the 24 hours of the user's last message, WhatsApp takes a template it approved.
await meta.send(
  createChannelMessage(
    {
      channel: 'whatsapp',
      to: '067 123 45 67',
      template: {
        name: 'login_code',
        language: 'uk',
        components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }],
      },
      metadata: { correlationId: login.id },
    },
    { defaultCountry: 'UA' },
  ),
);
// { successful: true, messageId: 'wamid.HBgM…', provider: 'meta', channel: 'whatsapp',
//   state: 'accepted' }
```

## WhatsApp

| Message                   | Cloud API                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `text`                    | `type: 'text'`                                                                                                       |
| `template`                | `type: 'template'`, its name, language and components                                                                |
| one medium                | `image`, `video`, `audio` or `document` by its type, a `link` or the `id` of a medium uploaded, the text its caption |
| up to three reply buttons | an interactive `button` message                                                                                      |
| one link button           | an interactive `cta_url` message                                                                                     |
| `metadata.correlationId`  | `biz_opaque_callback_data`, which the webhooks of its statuses give back                                             |
| `payload`                 | the fields of the body over those the transport writes (`context` to reply), but `to`                                |

## Messenger and Instagram

| Message                  | Send API                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `to`                     | `recipient.id`, the page-scoped or Instagram-scoped id                                                                        |
| `text` or one medium     | `message.text` (2000 characters of Messenger, 1000 bytes of Instagram), or an attachment at its URL or of its `attachment_id` |
| buttons of Messenger     | a button template, three at most: a link (`web_url`) or a `postback`                                                          |
| buttons of Instagram     | quick replies, thirteen at most                                                                                               |
| `metadata.correlationId` | the `metadata` of the message, which its echo gives back                                                                      |
| `payload`                | the fields of the body over those, such as `messaging_type: 'MESSAGE_TAG'` and its `tag` outside the window, but `recipient`  |

A message goes as a `RESPONSE`, within the 24 hours of the user's last
message, unless the payload says otherwise.

## Refused before any request

A text over the limit of its API (4096 characters of WhatsApp, 2000 of the
Send API, 1024 beside WhatsApp's buttons, 640 in a button template), more
buttons than a message takes, a button that calls a phone, a medium as bytes
(upload it to Meta and give its id), more than one medium, a template beside
media or buttons (they go in its components), a body of `type: 'template'`
without its template, and a block missing for the channel of the message.

## Receipts

Meta tells of the delivery through its webhooks: a receipt says
`state: 'accepted'`, the id Meta gives the message its id.

| Error                                                        | Category                                       |
| ------------------------------------------------------------ | ---------------------------------------------- |
| 131026, a recipient not on WhatsApp                          | `not-on-channel`: fall back to another channel |
| 131047, 2018278, outside the 24-hour window                  | `outside-window`: send a template              |
| 131050, a user who stopped marketing                         | `opted-out`                                    |
| 131021, 2018001                                              | `invalid-recipient`                            |
| 551, a person not available                                  | `blocked`                                      |
| 131049, held back by Meta                                    | `rejected`                                     |
| 0, 190, 131005                                               | `auth`                                         |
| 3, 10, 200–299, 368, an account restricted or not registered | `configuration`                                |
| 100, 131008–132999 (parameters, templates)                   | `validation`                                   |
| 4, 613, 80007, 130429, 131048, 131056                        | `rate-limit`, retried                          |
| 1, 2, 131000, 131016, 131057                                 | `service-unavailable`, retried in a 4xx        |

Neither API takes an idempotency key: a send whose answer was lost, or that
was answered with a 5xx, after which Meta may have taken it, is never retried,
and its receipt is `deliveryUnknown`.

`verify()` reads the number, the page and the account, each with its token.
