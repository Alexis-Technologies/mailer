# Microsoft Teams

`@alexify/mailer/teams` posts to Microsoft Teams in two ways: to a channel
through a [webhook of Workflows](https://support.microsoft.com/office/create-incoming-webhooks-with-workflows-for-microsoft-teams-8ae491c7-0394-4861-ba59-055e33f75498),
whose URL is its credential, and to a conversation through a bot of the
[Bot Framework](https://learn.microsoft.com/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages),
with the token of its app.

```js
const { TeamsTransport } = require('@alexify/mailer/teams');
const { createChannelMessage } = require('@alexify/mailer/channels');

const teams = new TeamsTransport({
  webhookUrl: process.env.TEAMS_WEBHOOK_URL,
  bot: { appId: process.env.TEAMS_APP_ID, clientSecret: process.env.TEAMS_CLIENT_SECRET },
});

// To the channel of the webhook: no `to`.
await teams.send(
  createChannelMessage({
    channel: 'teams',
    text: 'Deployed **v1.2.3**',
    buttons: [{ type: 'url', text: 'Open the run', url: 'https://ci.example.com/runs/1' }],
  }),
);
// { successful: true, messageId: 'webhook:…', provider: 'teams',
//   channel: 'teams', state: 'accepted' }

// To a conversation of the bot, by the reference an activity gave it.
await teams.send(
  createChannelMessage({
    channel: 'teams',
    to: { serviceUrl: activity.serviceUrl, conversationId: activity.conversation.id },
    text: 'Your report is ready',
  }),
);
// { successful: true, messageId: '1:…', provider: 'teams', channel: 'teams',
//   state: 'sent' }
```

## The webhook

A message without `to` goes to the webhook as an Adaptive Card 1.4 in the
envelope of an activity: its text a `TextBlock`, one picture by URL an
`Image`, its buttons actions (`Action.OpenUrl`, `Action.Submit` with the id of
a reply). A webhook of Workflows answers 202 before its flow posts the card,
so the receipt says `state: 'accepted'`, with an id of the transport's own,
as Teams gives none. A webhook of the Office 365 connectors, which Microsoft
retires, answers 200 with `1`, or with the error it met, which fails the
receipt by its status.

## The bot

A message with `to`, the `serviceUrl` and the `conversationId` of an
activity the bot got, goes through the Connector API
(`/v3/conversations/<id>/activities`), its text alone (Markdown) when it has
no button or picture, else the card. The token of the app is asked for with
its client credentials (at the tenant of `bot.tenantId`, or `botframework.com`
for a multi-tenant app; `login.microsoftonline.us` and the scope of
`api.botframework.us` for GCC High and DoD, by a `tokenUrl` of `.us`), once, and
shared until five minutes before its end;
it goes only to a service URL of Teams (`smba.trafficmanager.net`, and the
clouds of government) or of the origins of `serviceUrls`, so that a reference
from elsewhere does not get it. A bot can write only to a conversation it is
in; the conversations it starts on its own, and the activities it receives,
are for a later release.

## What goes

`payload` holds the fields of the activity over those (`attachments` for a
card of your own, `summary`, `channelData`). A mention is an entity of the
payload with its `<at>` in the text, so `mentions` is refused; so are a call
button, a medium that is no picture, and a message over the 28 KB of Teams,
before any request.

## Receipts

| Answer                                                              | Category                  |
| ------------------------------------------------------------------- | ------------------------- |
| webhook: 400 `Invalid webhook URL`, 401, 403, 404                   | `auth`                    |
| bot: `BotNotInConversationRoster` (removed, or blocked by the user) | `blocked`                 |
| bot: `ConversationNotFound`, 404                                    | `invalid-recipient`       |
| bot: 401                                                            | `auth`, the token dropped |
| bot: 403                                                            | `configuration`           |
| 429                                                                 | `rate-limit`, retried     |
| another 400, 413                                                    | `validation`              |

A 5xx, a timeout or a lost answer may come after the flow ran or the
activity was posted: its receipt is `deliveryUnknown`, never retried.
