// Not ported: the types of ./telegram, a transport over the Bot API of
// Telegram.

import type {
  Receipt,
  TelegramMessage,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

/**
 * The options of {@link TelegramTransport}.
 */
export interface TelegramConfig extends TransportDependencies {
  /** The token of the bot, `<id>:<secret>`, as BotFather gives it. */
  readonly botToken: string;
  /**
   * The markup of the texts and captions: `HTML` (escape what is not markup
   * with `escapeTelegramHtml` of `./channels`) or `MarkdownV2`; plain text,
   * whatever it holds, without one.  A message's `payload` may set its own
   * `parse_mode`.
   */
  readonly parseMode?: 'HTML' | 'MarkdownV2';
  /**
   * The Bot API server, https (or http to this machine), such as a local
   * `telegram-bot-api`.
   * @default "https://api.telegram.org"
   */
  readonly baseUrl?: string;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request Telegram did not take: after a 429, once its
   * `retry_after` has passed, or a connection never made.  Never after a
   * timeout or a 5xx, after which the message may have gone: that receipt is
   * of unknown delivery.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 5 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A transport over the Bot API of Telegram.  A text goes by `sendMessage`,
 * one medium by the method of its `contentType` (`sendPhoto`, `sendVideo`,
 * `sendAudio`, `sendAnimation` for a GIF, `sendDocument` for any other) with
 * the text as its caption, several by `sendMediaGroup`; a URL or a `file_id`
 * as it is, bytes as a file of the form.  Buttons are an inline keyboard (a
 * link, or a callback whose `id` is its `callback_data`), `thread` the topic
 * of a forum, a `low` priority a message without sound, and `payload` the
 * fields of the call over those the transport writes (`reply_parameters`,
 * `link_preview_options`), but `chat_id`.  A text over 4096 characters or a
 * caption over 1024 without markup, an album over ten media or with buttons,
 * and a button that calls a phone are refused before any request.
 *
 * A refusal is told by its description: a bot the user blocked or that was
 * removed is `blocked`, one the user never started `not-on-channel`, a chat
 * not found or a group moved to a supergroup (`migrate_to_chat_id` in its
 * `providerDetails`) `invalid-recipient`, a 429 `rate-limit` after its
 * `retry_after`.  Telegram tells a bot of no delivery: a receipt says
 * `state: 'sent'`, its id that of the chat and of the message, `<chat>:<id>`.
 *
 * @example
 * ```js
 * const { TelegramTransport } = require('@alexify/mailer/telegram');
 * const { createChannelMessage } = require('@alexify/mailer/channels');
 * const telegram = new TelegramTransport({ botToken: process.env.TELEGRAM_BOT_TOKEN });
 * await telegram.send(createChannelMessage({ channel: 'telegram', to: chatId, text: 'Hi' }));
 * ```
 */
export declare class TelegramTransport implements VerifiableTransport<'telegram', TelegramMessage> {
  readonly id = 'telegram';
  constructor(config: TelegramConfig);
  send(message: TelegramMessage, options?: TransportOptions): Promise<Receipt<'telegram'>>;
  sendMany(
    messages: Iterable<TelegramMessage> | AsyncIterable<TelegramMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'telegram'>>;
  /** Verifies the token by reading the bot (`getMe`). */
  verify(options?: TransportOptions): Promise<void>;
}
