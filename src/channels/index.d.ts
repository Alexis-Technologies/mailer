// Not ported: the types of ./channels, the messages of the channels other
// than email.

import type {
  ChannelMessage,
  DiscordMessage,
  E164,
  GoogleChatMessage,
  InstagramMessage,
  MessageOf,
  MessengerMessage,
  Priority,
  PushMessage,
  RcsMessage,
  SlackMessage,
  SmsMessage,
  TeamsMessage,
  TelegramMessage,
  ViberMessage,
  WhatsAppMessage,
} from '../../index.js';

/** What a message is made of: its `tags` and `priority` optional. */
type ConstructorOf<M extends ChannelMessage> = Omit<M, 'tags' | 'priority'> & {
  /** One tag or several. @default [] */
  readonly tags?: string | readonly string[];
  /** @default 'normal' */
  readonly priority?: Priority;
};
/** What a message to a phone is made of: its `to` as people write it. */
type PhoneConstructorOf<M extends SmsMessage | RcsMessage | WhatsAppMessage> = Omit<
  ConstructorOf<M>,
  'to'
> & {
  /**
   * The phone number: in E.164, in an international form (`00…`), or national
   * with `defaultCountry`.
   */
  readonly to: string;
};

/** The fields {@link createChannelMessage} takes, by channel. */
export interface ChannelMessageConstructors {
  readonly sms: PhoneConstructorOf<SmsMessage>;
  readonly rcs: PhoneConstructorOf<RcsMessage>;
  readonly whatsapp: PhoneConstructorOf<WhatsAppMessage>;
  readonly messenger: ConstructorOf<MessengerMessage>;
  readonly instagram: ConstructorOf<InstagramMessage>;
  readonly telegram: ConstructorOf<TelegramMessage>;
  readonly viber: ConstructorOf<ViberMessage>;
  readonly slack: ConstructorOf<SlackMessage>;
  readonly discord: ConstructorOf<DiscordMessage>;
  readonly teams: ConstructorOf<TeamsMessage>;
  readonly 'google-chat': ConstructorOf<GoogleChatMessage>;
  readonly push: ConstructorOf<PushMessage>;
}
/** The fields of a message of any channel but email, as {@link createChannelMessage} takes them. */
export type ChannelMessageConstructor =
  ChannelMessageConstructors[keyof ChannelMessageConstructors];

/** The options of {@link createChannelMessage} and {@link normalizePhone}. */
export interface PhoneOptions {
  /**
   * The ISO 3166-1 alpha-2 code of the country of a phone number written
   * without its calling code, such as `UA`: its trunk prefix (`0`, `1` in
   * North America, `8` in Russia) is dropped and its calling code put first.
   */
  readonly defaultCountry?: string;
}

/**
 * Creates the message of a channel other than email: its recipient of the
 * channel's kind (a phone in E.164, a chat id, a token of a device), its
 * media, buttons, mentions and payload checked and copied, and the fields of
 * another channel refused.
 *
 * @example
 * ```js
 * const sms = createChannelMessage(
 *   { channel: 'sms', to: '067 123 45 67', text: 'Your code is 1234', priority: 'high' },
 *   { defaultCountry: 'UA' },
 * );
 * // { channel: 'sms', to: '+380671234567', text: 'Your code is 1234', tags: [], priority: 'high' }
 * ```
 *
 * @throws {TypeError} If the channel is unknown or `email` (made by
 * `createMessage`), if a field is not one the channel takes or is invalid, or
 * if the message has nothing to send.
 */
export declare function createChannelMessage<C extends keyof ChannelMessageConstructors>(
  input: ChannelMessageConstructors[C] & { readonly channel: C },
  options?: PhoneOptions,
): MessageOf<C>;

/**
 * Checks again a message of a channel already made, such as a copy with a
 * field changed, which skips {@link createChannelMessage}.
 *
 * @throws {TypeError} If a field is one `createChannelMessage` refuses, or
 * `to` is a phone not in E.164.
 */
export declare function checkChannelMessage(message: ChannelMessage): void;

/** Whether a value is a message of a channel other than email, by its `channel`. */
export declare function isChannelMessage(value: unknown): value is ChannelMessage;

/**
 * A phone number in E.164 from the way people write one: `+38 (067)
 * 123-45-67`, `00380671234567`, `011 44 20 7946 0018` in North America, or
 * `067 123 45 67` with `defaultCountry: 'UA'`.  It does not check a national
 * number against the numbering plan of its country.
 *
 * @returns The number, or `undefined` when it is none, or national without
 * `defaultCountry`.
 * @throws {TypeError} If `defaultCountry` is not the code of a country.
 */
export declare function normalizePhone(input: string, options?: PhoneOptions): E164 | undefined;

/**
 * Whether a value is a phone number in E.164: `+`, a country calling code
 * and at least four more digits, fifteen digits at most.
 */
export declare function isE164(value: unknown): value is E164;

/** How a text goes as an SMS. */
export interface SmsSegments {
  /** `GSM-7` when every character is of its alphabet, `UCS-2` otherwise. */
  readonly encoding: 'GSM-7' | 'UCS-2';
  /**
   * The segments a carrier bills: 1 up to 160 septets or 70 code units,
   * then 153 or 67 in each, no character split between two.
   */
  readonly segments: number;
  /** Septets of GSM-7 (two for a character of its extension), or UTF-16 code units. */
  readonly units: number;
  /** Code points. */
  readonly characters: number;
}

/**
 * How a text goes as an SMS: its encoding and the segments a carrier bills.
 * Any Cyrillic text, Ukrainian among them, is UCS-2.
 *
 * @throws {TypeError} If the text is not a string.
 */
export declare function countSegments(text: string): SmsSegments;

/** A text for the HTML of Telegram: `&`, `<`, `>` and `"` as entities. */
export declare function escapeTelegramHtml(text: string): string;
/** A text for the mrkdwn of Slack: `&`, `<` and `>` as entities. */
export declare function escapeSlackText(text: string): string;
/** A text for the Markdown of Discord: each character of its syntax after a backslash. */
export declare function escapeDiscordMarkdown(text: string): string;
/**
 * A text whose mentions of a whole channel notify no one: `@everyone` and
 * `@here` (Discord, Teams), `<!channel>`, `<!here>` and `<!everyone>`
 * (Slack).  A transport of a work chat applies it unless the message's
 * `mentions` allow `everyone`.
 */
export declare function neutralizeMentions(text: string): string;
