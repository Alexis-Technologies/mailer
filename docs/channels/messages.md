# Messages of the channels

A message of SMS, RCS, WhatsApp, Messenger, Instagram, Telegram, Viber, Slack,
Discord, Teams, Google Chat or push is made by `createChannelMessage` of
`@alexify/mailer/channels`, as an email message is made by `createMessage`. Its
`channel` names its type, and a transport of a channel takes the messages of
that channel alone.

The transports of the channels come later in 2.0: this page describes the
messages they will take, and the helpers that go with them.

```js
const { createChannelMessage } = require('@alexify/mailer/channels');

const sms = createChannelMessage(
  { channel: 'sms', to: '067 123 45 67', text: 'Ваш код 1234', priority: 'high' },
  { defaultCountry: 'UA' },
);
// { channel: 'sms', to: '+380671234567', text: 'Ваш код 1234', tags: [], priority: 'high' }
```

## Fields

Every channel takes:

| Field | |
| --- | --- |
| `channel` | `sms`, `rcs`, `whatsapp`, `messenger`, `instagram`, `telegram`, `viber`, `slack`, `discord`, `teams`, `google-chat` or `push`. |
| `to` | The recipient, of the channel's kind (below). |
| `from` | The sender: a number, a sender id, a bot, a page, as the channel names it. |
| `text` | The text. |
| `media` | Pictures, videos or documents: `{ url }` the provider fetches, `{ id }` it holds already, or `{ content, contentType }`, each with an optional `filename` and `caption`. |
| `buttons` | `{ type: 'url', text, url }`, `{ type: 'reply', text, id }` or `{ type: 'call', text, phone }`. |
| `payload` | What the channel takes as it is (a Block Kit, an Adaptive Card, an embed, the overrides of a push), as JSON. |
| `mentions` | Who a message of a work chat may notify: `{ everyone, users, roles }`. None by default. |
| `tags`, `priority` | As for email; `[]` and `normal` by default. |
| `metadata`, `tenantId`, `idempotencyKey` | As for email: `metadata.correlationId` is what a delivery event finds its message by. |
| `scheduledAt` | When to send it, which [the queue](/guide/queue) waits for; a transport of a channel schedules none, so it refuses one sent to it directly (`unsupported`) rather than send it at once. |
| `expiresAt` | When the message is no longer worth delivering: the validity period of an SMS, the TTL of a push. |

and a few take one more: `template` (WhatsApp, a template it approved:
`{ name, language, components }`), `thread` (Telegram, Slack, Discord, Google
Chat), `title` and `data` (push). A field of another channel is refused, as is
a message with nothing to send.

| Channel | `to` |
| --- | --- |
| `sms`, `rcs`, `whatsapp` | A phone number: given in E.164, an international form, or national with `defaultCountry`, and kept in E.164. |
| `messenger`, `instagram`, `viber` | The id the platform gave the user. |
| `telegram` | A chat id (a number, or its digits), or the `@username` of a channel. |
| `slack`, `discord`, `google-chat` | The id of a channel or a space; none for a webhook, whose URL names it. |
| `teams` | `{ serviceUrl, conversationId }` of a conversation a bot was installed in; none for a webhook. |
| `push` | `{ token }` of a device, `{ topic }` of FCM, or a subscription of Web Push, `{ endpoint, keys: { p256dh, auth } }`. |

`checkChannelMessage(message)` checks again a message already made, such as a
copy with a field changed, and `isChannelMessage(value)` tells a message of a
channel from an email one.

## Phone numbers

`normalizePhone` gives a number in E.164 from the way people write one, without
a library of numbering plans:

```js
const { normalizePhone, isE164 } = require('@alexify/mailer/channels');

normalizePhone('+38 (067) 123-45-67'); // '+380671234567'
normalizePhone('(415) 555-2671', { defaultCountry: 'US' }); // '+14155552671'
normalizePhone('067 123 45 67'); // undefined: national, without its country
isE164('+380671234567'); // true
```

An international number is taken with `+`, `00`, `011` in North America,
`0011` in Australia or `810` in Russia, Kazakhstan and Belarus, a trunk `0`
written after its calling code left out (`+44 07911…`). A national one needs
`defaultCountry`, whose trunk prefix is dropped (`0` in most countries, `1` in
North America, `06` in Hungary, `8` in Russia and its neighbours, only before
a number of their length, as Russian numbers may begin with 8 too) and calling
code put first; Italy keeps the `0` of its numbers. Digits that begin with the
calling code of a country of a trunk `0`, without it, are the code and a number
written without `+` (`380671234567` in Ukraine). The length of a national
number is not checked against the plan of its country otherwise: a provider
refuses a number that is none, as `invalid-recipient`.

## Segments of an SMS

`countSegments` tells how a carrier bills a text: GSM-7 when every character is
of its alphabet, UCS-2 otherwise, 160 septets or 70 code units alone, 153 or 67
in each part of a longer one, no character split between two parts.

```js
const { countSegments } = require('@alexify/mailer/channels');

countSegments('Your code is 1234'); // { encoding: 'GSM-7', segments: 1, units: 17, characters: 17 }
countSegments('Ваш код 1234'); // { encoding: 'UCS-2', segments: 1, units: 12, characters: 12 }
```

Any Cyrillic text, Ukrainian among them, is UCS-2: no carrier is sent a national
table of GSM 03.38.

## Markup of the chats

Text of your own put into the markup of a chat should be escaped as text:

```js
const {
  escapeTelegramHtml,
  escapeSlackText,
  escapeDiscordMarkdown,
  neutralizeMentions,
} = require('@alexify/mailer/channels');

escapeTelegramHtml('Price < 10 & up'); // 'Price &lt; 10 &amp; up'
escapeSlackText('<!channel>'); // '&lt;!channel&gt;'
escapeDiscordMarkdown('**bold**'); // '\\*\\*bold\\*\\*'
neutralizeMentions('Deployed, @everyone'); // 'Deployed, @​everyone'
```

`neutralizeMentions` keeps `@everyone`, `@here` and Slack's `<!channel>`,
`<!here>` and `<!everyone>` from notifying a whole channel; the transports of
the work chats will apply it unless `mentions.everyone` is set.
