// Not ported: the types of ./teams, a transport of messages of Microsoft
// Teams, through a webhook of Workflows or a bot of the Bot Framework.

import type {
  Receipt,
  TeamsMessage,
  Transport,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

/** The app of a bot of the Bot Framework, registered in Azure. */
export interface TeamsBotApp {
  readonly appId: string;
  /** The client secret of the app (its password in the Bot Framework). */
  readonly clientSecret: string;
  /** The tenant of a single-tenant app; a multi-tenant one asks botframework.com. */
  readonly tenantId?: string;
}

/**
 * The options of {@link TeamsTransport}: a webhook, a bot, or both.
 */
export interface TeamsConfig extends TransportDependencies {
  /** The URL of a webhook of Workflows (or of an Office 365 connector), a credential itself. */
  readonly webhookUrl?: string;
  /** The app of the bot that writes to conversations. */
  readonly bot?: TeamsBotApp;
  /**
   * The token endpoint of Microsoft Entra; `https://login.microsoftonline.us/…` for GCC High
   * and DoD.
   * @default "https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token"
   */
  readonly tokenUrl?: string;
  /**
   * The scope of the token of the bot.
   * @default "https://api.botframework.us/.default" for a tokenUrl of `.us`, else "https://api.botframework.com/.default"
   */
  readonly scope?: string;
  /**
   * Service URLs the token of the bot may go to beyond those of Teams
   * (`smba.trafficmanager.net` and the clouds of government), by origin.
   */
  readonly serviceUrls?: readonly string[];
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request Teams did not take: a 429 or a connection never
   * made.  Never after a 5xx, a timeout or a lost answer: that receipt is of
   * unknown delivery.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 5 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The clock of the token of the bot. @default Date.now */
  readonly now?: () => number;
}

/**
 * A transport of messages of Microsoft Teams.  A message without `to` goes
 * to the webhook as an Adaptive Card (its text a TextBlock, one picture an
 * Image, its buttons actions); one with `to`, a `serviceUrl` and a
 * `conversationId` a bot got from an activity, goes to that conversation
 * through the Connector API with the token of the bot's app, its text alone
 * when it has no button or picture.  The token goes only to a service URL of
 * Teams, or of `serviceUrls`.  `payload` holds the fields of the activity
 * over those (`attachments`, `summary`, `channelData`); a mention is an
 * entity of the payload; a message over 28 KB is refused before any request.
 *
 * A webhook of Workflows answers 202 before its flow posts the card: the
 * receipt says `state: 'accepted'`, with an id of the transport's own.  A
 * bot's receipt says `state: 'sent'`, the id of the activity its id; a bot
 * removed from the conversation is `blocked`.
 *
 * @example
 * ```js
 * const { TeamsTransport } = require('@alexify/mailer/teams');
 * const teams = new TeamsTransport({ webhookUrl: process.env.TEAMS_WEBHOOK_URL });
 * ```
 */
export declare class TeamsTransport implements VerifiableTransport<'teams', TeamsMessage> {
  readonly id = 'teams';
  constructor(config: TeamsConfig);
  send(message: TeamsMessage, options?: TransportOptions): Promise<Receipt<'teams'>>;
  sendMany(
    messages: Iterable<TeamsMessage> | AsyncIterable<TeamsMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'teams'>>;
  /**
   * Verifies the app of the bot by asking for its token; a webhook cannot be checked
   * without posting, so a transport of a webhook alone verifies nothing.
   */
  verify(options?: TransportOptions): Promise<void>;
}
