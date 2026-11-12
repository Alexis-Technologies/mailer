# Telegram

`@alexify/mailer/telegram` sends the messages of a Telegram bot through the
[Bot API](https://core.telegram.org/bots/api), over `fetch`, with the token of
the bot BotFather gives.

```js
const { TelegramTransport } = require('@alexify/mailer/telegram');
const { createChannelMessage, escapeTelegramHtml } = require('@alexify/mailer/channels');

const telegram = new TelegramTransport({
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  parseMode: 'HTML',
});

const receipt = await telegram.send(
  createChannelMessage({
    channel: 'telegram',
    to: chatId, // a chat id, or the @username of a channel
    text: `Your order <b>${escapeTelegramHtml(order.number)}</b> has shipped.`,
    buttons: [{ type: 'url', text: 'Track it', url: order.trackingUrl }],
  }),
);
// { successful: true, messageId: '987654321:12345', provider: 'telegram',
//   channel: 'telegram', state: 'sent' }
```

The Bot API takes its token in the path of each request
(`https://api.telegram.org/bot<token>/sendMessage`). The transport never writes
that URL into an error, a receipt or a log, but a `fetch` you pass in, a
proxy or an instrumentation of `fetch` (the `url.full` of OpenTelemetry's HTTP
instrumentation) may record it: keep such logs as secret as the token, or
leave the URL out of them.

## What goes

| Message | Call |
| --- | --- |
| a text | `sendMessage` |
| one medium | the method of its `contentType`: `sendPhoto`, `sendVideo`, `sendAudio`, `sendAnimation` for a GIF, `sendDocument` for any other, the text as its caption |
| two to ten media | `sendMediaGroup`, an album: photos and videos together, or documents, or audios, the text as the caption of the first |
| `buttons` | an inline keyboard, one a row: a link, or a callback whose `id` is its `callback_data` (64 bytes at most) |
| `thread` | `message_thread_id`, the topic of a forum |
| `priority: 'low'` | `disable_notification`: a message without sound |
| `payload` | the fields of the call over those the transport writes, such as `reply_parameters`, `link_preview_options` or `protect_content`, but `chat_id` |

A medium at a URL or under a `file_id` (`{ id }`) goes as it is; bytes go as a
file of a multipart form. Without `parseMode` a text is plain, whatever it
holds; with `HTML` or `MarkdownV2`, escape what is not markup
(`escapeTelegramHtml` of [`./channels`](/channels/messages)), and a
`payload` may set its own `parse_mode`.

Refused before any request, as Telegram would refuse them: a text of more than
4096 characters or a caption of more than 1024, without markup (with it,
Telegram counts after its entities are parsed); an album of more than ten media,
of a mix it does not take, or with buttons; a button that calls a phone, which
an inline keyboard cannot do; a `thread` that is not a number.

## Receipts

Telegram tells a bot of no delivery: a receipt says `state: 'sent'`, and its id
is that of the chat and of the message, `<chat>:<message_id>`, as a
`message_id` is one only within its chat; an album is named by its first.

| Refusal | Category |
| --- | --- |
| 403, the bot was blocked, kicked or is no member | `blocked` |
| 403, the user never started the bot | `not-on-channel` |
| 403, a deactivated user, or a bot | `invalid-recipient` |
| 400, chat not found | `invalid-recipient` |
| 400, a group moved to a supergroup | `invalid-recipient`, `migrate_to_chat_id` in its `providerDetails` |
| 400, no rights to write in the chat | `blocked` |
| 400, anything else | `validation` |
| 401, 404 | `auth` |
| 429 | `rate-limit`, retried after the `retry_after` of its body |
| 5xx, a timeout | of unknown delivery, not retried |

The Bot API has no idempotency key, and may answer a 5xx once the message went:
such a send is never retried, and its receipt is `deliveryUnknown`. A send is
retried only after a 429 (once its `retry_after` has passed, up to half a
minute; a longer wait is left to the queue) or a connection never made.
Telegram limits a bot to about 30 messages a second, and one a second in a
chat: put a [rate limit](/transports/ratelimit) before the transport.

`verify()` reads the bot (`getMe`). `baseUrl` points it at a local
`telegram-bot-api` server.
