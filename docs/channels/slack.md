# Slack

`@alexify/mailer/slack` posts to Slack through `chat.postMessage` of the
[Web API](https://api.slack.com/methods/chat.postMessage), with the token of a
bot, and through an [incoming webhook](https://api.slack.com/messaging/webhooks),
whose URL is the credential: a message with `to` goes through the first, one
without it to the channel of the webhook.

```js
const { SlackTransport } = require('@alexify/mailer/slack');
const { createChannelMessage, escapeSlackText } = require('@alexify/mailer/channels');

const slack = new SlackTransport({
  botToken: process.env.SLACK_BOT_TOKEN, // chat:write
  webhookUrl: process.env.SLACK_WEBHOOK_URL, // either, or both
});

await slack.send(
  createChannelMessage({
    channel: 'slack',
    to: 'C0123ABCD', // a channel or a user; without it, the webhook's
    text: `Deployed *${escapeSlackText(release.name)}*`,
    buttons: [{ type: 'url', text: 'Open', url: release.url }],
  }),
);
// { successful: true, messageId: 'C0123ABCD:1700000000.000100', provider: 'slack',
//   channel: 'slack', state: 'sent' }
```

## What goes

| Message | Body |
| --- | --- |
| `to` | `channel` of `chat.postMessage`; none for the webhook |
| `text` | `text`, in mrkdwn |
| `thread` | `thread_ts`, the message it replies to |
| `buttons` | an `actions` block: a link, or a reply whose `id` is its `value` |
| `media` | an `image` block for a picture at its URL |
| `payload` | the fields of the body over those the transport writes (`blocks`, `unfurl_links`, `username`), but `channel` |

The text is mrkdwn: escape what is not markup with `escapeSlackText` of
[`./channels`](/channels/messages). Its mentions of a whole channel
(`<!channel>`, `<!here>`, `<!everyone>`), of users (`<@U…>`) and of groups
(`<!subteam^S…>`) are neutralized unless the message names them in `mentions`
(`everyone`, `users`, `roles`), so a text of a user cannot notify everyone. A
`payload` goes as it is: mentions in its blocks are yours to mind.

With buttons or pictures the text becomes a section of Block Kit before them,
and stays the text of the notification. Refused before any request: a file,
which a post cannot carry (Slack uploads files apart), a medium that is no
picture at a URL, a button that calls a phone, buttons beside the `blocks` of
a payload, a text of more than 40000 characters, or of more than 3000 beside
buttons or pictures.

## Receipts

Slack tells of no delivery: a receipt says `state: 'sent'`. Its id is
`<channel>:<ts>` through the Web API, what a reply or an edit names; a webhook
names no message, so its receipt's id is `webhook:<id>` of `generateId`.

The Web API answers a refusal in a 200 with `ok: false` and its `error`; a
webhook, in the text of its status:

| Error | Category |
| --- | --- |
| `channel_not_found`, `is_archived`, `channel_is_archived` | `invalid-recipient` |
| `not_in_channel` | `not-on-channel`: invite the bot |
| `restricted_action…`, `action_prohibited` | `blocked` |
| `msg_too_long`, `no_text`, `invalid_blocks`, `invalid_payload` | `validation` |
| `invalid_auth`, `token_revoked`, `invalid_token`, `no_service` | `auth` |
| `missing_scope`, `no_permission` | `configuration` |
| `ratelimited`, a 429 | `rate-limit`, retried after its `Retry-After` |
| `service_unavailable` | `service-unavailable`, retried |
| `fatal_error`, `internal_error`, a 5xx, a timeout | of unknown delivery, not retried |

`chat.postMessage` has no idempotency key, and Slack may have posted a message
before a `fatal_error`, a 5xx or a lost answer: such a send is never retried.
Slack takes about one message a second in a channel: put a
[rate limit](/transports/ratelimit) before the transport.

`verify()` calls `auth.test` with the token; a webhook cannot be checked
without posting, so a transport of a webhook alone verifies nothing.
