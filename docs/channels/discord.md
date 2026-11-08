# Discord

`@alexify/mailer/discord` sends to Discord through the
[REST API of a bot](https://discord.com/developers/docs/resources/message#create-message)
and through a [webhook](https://discord.com/developers/docs/resources/webhook#execute-webhook),
whose URL is the credential: a message with `to`, a channel, is created by the
bot, one without it goes to the channel of the webhook.

```js
const { DiscordTransport } = require('@alexify/mailer/discord');
const { createChannelMessage, escapeDiscordMarkdown } = require('@alexify/mailer/channels');

const discord = new DiscordTransport({
  botToken: process.env.DISCORD_BOT_TOKEN,
  webhookUrl: process.env.DISCORD_WEBHOOK_URL, // either, or both
});

await discord.send(
  createChannelMessage({
    channel: 'discord',
    to: '1100000000000000099', // a channel; without it, the webhook's
    text: `Deployed **${escapeDiscordMarkdown(release.name)}**`,
    buttons: [{ type: 'url', text: 'Open', url: release.url }],
    idempotencyKey: `deploy:${release.id}`,
  }),
);
// { successful: true, messageId: '1100000000000000001', provider: 'discord',
//   channel: 'discord', state: 'sent' }
```

## What goes

| Message | Body |
| --- | --- |
| `to` | the channel of `POST /channels/{id}/messages`; none for the webhook |
| `thread` | the thread the bot posts into; `thread_id` of the webhook |
| `text` | `content`, in Discord's Markdown |
| `mentions` | `allowed_mentions`: none unless named |
| `buttons` | components in rows of five: a link, or of a bot a reply whose `id` is its `custom_id` |
| `media` | a picture at a URL as an embed, bytes as a file of a multipart form |
| `priority: 'low'` | the flag `SUPPRESS_NOTIFICATIONS` |
| `payload` | the fields of the body over those the transport writes (`embeds`, `components`, `tts`, `username`), but the nonce |

**No mention notifies unless the message names it.** `allowed_mentions` is
`{ parse: [] }` with the users and roles of `mentions`, and `everyone: true`
adds `@everyone` and `@here`: a text of a user that holds `@everyone` reads as
such and pings no one.

Refused before any request: a text of more than 2000 characters, more than ten
embeds or files or 25 buttons, a label of more than 80 characters, a button
that calls a phone, a button that replies through a webhook (only links go
there), and pictures or buttons beside the `embeds` or `components` of a
payload.

## Retries and rate limits

A message of a bot carries a nonce, a hash of its `idempotencyKey` (or of an id
of `generateId`), with `enforce_nonce`: Discord answers a nonce it saw in the
last minutes with the message it created rather than create another, so a send
of a bot is retried after a timeout, a lost answer or a 5xx, and only its last
failure is of unknown delivery. A webhook takes no nonce: such a send through
it is never retried, and its receipt is `deliveryUnknown`.

A send waits for the bucket of its route when Discord said it was empty
(`X-RateLimit-Remaining: 0`, until `X-RateLimit-Reset-After`), up to half a
minute; past it the receipt is `rate-limit` with the wait, for a queue to
schedule. A 429 counts as an attempt and waits its `retry_after`.

## Receipts

The receipt says `state: 'sent'`, the snowflake of the message its id.

| Refusal | Category |
| --- | --- |
| 10003 unknown channel, 10013 unknown user, 50083 archived thread, a 404 | `invalid-recipient` |
| 50001 missing access, 50013 missing permissions, 50007 a user who takes no message, a 403 | `blocked` |
| 10015 unknown webhook, a 401 | `auth` |
| 50035 invalid form body, 50006 an empty message, 40005 too large, a 400 | `validation` |
| 429 | `rate-limit` |

`verify()` reads the bot (`/users/@me`) and the webhook, which posts nothing.
