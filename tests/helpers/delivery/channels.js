// Not ported: the providers of the channels the delivery matrix holds, each
// with a message of its channel, the answer of a send, a rate limit as it
// tells it, and what must never reach a log: its secrets and its recipient.
const { createChannelMessage } = require('../../../src/channels/index.js');
const { SlackTransport } = require('../../../src/slack/index.js');
const { TelegramTransport } = require('../../../src/telegram/index.js');

const TELEGRAM_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const SLACK_TOKEN = 'xoxb-1111-2222-SlackBotSecret';
const SLACK_WEBHOOK = 'https://hooks.slack.com/services/T000/B000/SlackWebhookSecret';

const channelProviders = [
  {
    name: 'Telegram',
    create: (extra) => new TelegramTransport({ retries: 1, ...extra, botToken: TELEGRAM_TOKEN }),
    message: () =>
      createChannelMessage({ channel: 'telegram', to: 987654321, text: 'Your code is 1234' }),
    ok: () => Response.json({ ok: true, result: { message_id: 7, chat: { id: 987654321 } } }),
    // Telegram tells the wait in its body, not in Retry-After.
    rateLimited: (seconds) =>
      Response.json(
        {
          ok: false,
          error_code: 429,
          description: `Too Many Requests: retry after ${seconds}`,
          parameters: { retry_after: seconds },
        },
        { status: 429 },
      ),
    secrets: [TELEGRAM_TOKEN, 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'],
    recipient: '987654321',
  },
  {
    name: 'Slack',
    create: (extra) =>
      new SlackTransport({
        retries: 1,
        ...extra,
        botToken: SLACK_TOKEN,
        webhookUrl: SLACK_WEBHOOK,
      }),
    message: () =>
      createChannelMessage({ channel: 'slack', to: 'C0SECRETCHAN', text: 'Deployed v1.2.3' }),
    ok: () => Response.json({ ok: true, channel: 'C0SECRETCHAN', ts: '1700000000.000100' }),
    rateLimited: (seconds) =>
      Response.json(
        { ok: false, error: 'ratelimited' },
        { status: 429, headers: { 'Retry-After': String(seconds) } },
      ),
    secrets: [SLACK_TOKEN, 'SlackBotSecret', 'SlackWebhookSecret'],
    recipient: 'C0SECRETCHAN',
  },
  {
    name: 'Slack webhook',
    create: (extra) => new SlackTransport({ retries: 1, ...extra, webhookUrl: SLACK_WEBHOOK }),
    message: () => createChannelMessage({ channel: 'slack', text: 'Deployed v1.2.3' }),
    ok: () => new Response('ok'),
    rateLimited: (seconds) =>
      new Response('rate_limited', { status: 429, headers: { 'Retry-After': String(seconds) } }),
    secrets: ['SlackWebhookSecret'],
    recipient: 'SlackWebhookSecret',
  },
];

module.exports = { channelProviders };
