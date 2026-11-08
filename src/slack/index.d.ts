// Not ported: the types of ./slack, a transport of Slack over its Web API and
// its incoming webhooks.

import type {
  Receipt,
  SlackMessage,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

interface SlackConfigBase extends TransportDependencies {
  /**
   * The Web API, https (or http to this machine).
   * @default "https://slack.com/api"
   */
  readonly baseUrl?: string;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request Slack did not take: a 429 after its `Retry-After`,
   * a `service_unavailable`, or a connection never made.  Never after a
   * timeout, a 5xx or a `fatal_error`, after which the message may have been
   * posted: that receipt is of unknown delivery.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 5 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * The options of {@link SlackTransport}: the token of a bot, the URL of an
 * incoming webhook, or both.
 */
export type SlackConfig = SlackConfigBase &
  (
    | {
        /** The token of the bot (`xoxb-…`), with `chat:write`: for the messages with `to`. */
        readonly botToken: string;
        /** The incoming webhook, its URL the credential: for the messages without `to`. */
        readonly webhookUrl?: string;
      }
    | { readonly botToken?: string; readonly webhookUrl: string }
  );

/**
 * A transport of Slack.  A message with `to`, a channel or a user, goes by
 * `chat.postMessage` of the Web API; one without it, to the channel of the
 * incoming webhook.  Its text is mrkdwn (escape what is not markup with
 * `escapeSlackText` of `./channels`), its mentions of a whole channel
 * (`<!channel>`, `<!here>`, `<!everyone>`), of users and of groups
 * neutralized but those its `mentions` name; `thread` is the `ts` it
 * replies to; buttons (a link, or a reply whose `id` is its `value`) and
 * pictures at a URL become Block Kit after the text; `payload` holds the
 * fields of the body over those the transport writes (`blocks`,
 * `unfurl_links`, `username`), but `channel`.  A file, a medium that is no
 * picture at a URL, and a button that calls a phone are refused before any
 * request, as are a text over 40000 characters, and over 3000 beside
 * buttons or pictures.
 *
 * An `ok: false` is told by its error: `channel_not_found` and an archived
 * channel are `invalid-recipient`, `not_in_channel` `not-on-channel`, a
 * restricted channel `blocked`, `invalid_auth` `auth`, `missing_scope`
 * `configuration`, a `fatal_error` of unknown delivery.  Slack tells of no
 * delivery: a receipt says `state: 'sent'`, its id `<channel>:<ts>` through
 * the Web API, and `webhook:<id>` of `generateId` through a webhook, which
 * names no message.
 *
 * @example
 * ```js
 * const { SlackTransport } = require('@alexify/mailer/slack');
 * const slack = new SlackTransport({ botToken: process.env.SLACK_BOT_TOKEN });
 * await slack.send(createChannelMessage({ channel: 'slack', to: 'C0123', text: 'Deployed' }));
 * ```
 */
export declare class SlackTransport implements VerifiableTransport<'slack', SlackMessage> {
  readonly id = 'slack';
  constructor(config: SlackConfig);
  send(message: SlackMessage, options?: TransportOptions): Promise<Receipt<'slack'>>;
  sendMany(
    messages: Iterable<SlackMessage> | AsyncIterable<SlackMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'slack'>>;
  /**
   * Verifies the token of the bot (`auth.test`); a webhook cannot be checked
   * without posting, so a transport of a webhook alone verifies nothing.
   */
  verify(options?: TransportOptions): Promise<void>;
}
