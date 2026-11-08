// Not ported: the types of ./discord, a transport of Discord over the REST
// API of a bot and over webhooks.

import type {
  DiscordMessage,
  Receipt,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

interface DiscordConfigBase extends TransportDependencies {
  /**
   * The REST API, https (or http to this machine).
   * @default "https://discord.com/api/v10"
   */
  readonly baseUrl?: string;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request: of a bot, after a 429, a 5xx, a timeout or a lost
   * answer, as its nonce makes Discord return the message it created rather
   * than create another; of a webhook, which takes no nonce, after a 429 or a
   * connection never made alone.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 5 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * The options of {@link DiscordTransport}: the token of a bot, the URL of a
 * webhook, or both.
 */
export type DiscordConfig = DiscordConfigBase &
  (
    | {
        /** The token of the bot, for the messages with `to`. */
        readonly botToken: string;
        /** The webhook, its URL the credential: for the messages without `to`. */
        readonly webhookUrl?: string;
      }
    | { readonly botToken?: string; readonly webhookUrl: string }
  );

/**
 * A transport of Discord.  A message with `to`, a channel, is created by
 * the bot (`POST /channels/{id}/messages`, into the thread of `thread` when
 * it has one) under a nonce of its `idempotencyKey` that Discord enforces;
 * one without it goes to the webhook (`?wait=true`, `thread_id` of
 * `thread`).  No mention notifies unless the message's `mentions` name it:
 * `allowed_mentions` is `{ parse: [] }` with the users and roles named, and
 * `everyone` adds `@everyone` and `@here`.  Buttons are components in rows of
 * five (a link, or of a bot a reply whose `id` is its `custom_id`), pictures
 * at a URL embeds, bytes files of a multipart form, a `low` priority a
 * message without notification; `payload` holds the fields of the body over
 * those the transport writes (`embeds`, `components`, `tts`, `username`), but
 * the nonce.  A text over 2000 characters, more than ten embeds or files or
 * 25 buttons, and a button that calls a phone are refused before any
 * request.
 *
 * A send waits for the bucket of its route when Discord said it was empty
 * (`X-RateLimit-Remaining`, `X-RateLimit-Reset-After`), up to half a minute;
 * a 429 waits its `retry_after`.  A refusal is told by its JSON code: an
 * unknown channel or user is `invalid-recipient`, missing access or
 * permissions, or a user who takes no message, `blocked`.  The receipt says
 * `state: 'sent'`, the snowflake of the message its id.
 *
 * @example
 * ```js
 * const { DiscordTransport } = require('@alexify/mailer/discord');
 * const discord = new DiscordTransport({ webhookUrl: process.env.DISCORD_WEBHOOK_URL });
 * await discord.send(createChannelMessage({ channel: 'discord', text: 'Deployed' }));
 * ```
 */
export declare class DiscordTransport implements VerifiableTransport<'discord', DiscordMessage> {
  readonly id = 'discord';
  constructor(config: DiscordConfig);
  send(message: DiscordMessage, options?: TransportOptions): Promise<Receipt<'discord'>>;
  sendMany(
    messages: Iterable<DiscordMessage> | AsyncIterable<DiscordMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'discord'>>;
  /** Verifies the token by reading the bot (`/users/@me`), and the webhook by reading it. */
  verify(options?: TransportOptions): Promise<void>;
}
