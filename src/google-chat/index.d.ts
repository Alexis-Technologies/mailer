// Not ported: the types of ./google-chat, a transport of messages of Google
// Chat, through the webhook of a space or a Chat app.

import type { GoogleServiceAccount } from '../fcm/index.js';
import type {
  GoogleChatMessage,
  Receipt,
  TransportDependencies,
  TransportOptions,
  VerifiableTransport,
} from '../../index.js';

export type { GoogleServiceAccount };

/**
 * The options of {@link GoogleChatTransport}: a webhook, a Chat app, or both.
 */
export interface GoogleChatConfig extends TransportDependencies {
  /** The URL of the webhook of a space, its key and token in its query, a credential itself. */
  readonly webhookUrl?: string;
  /**
   * The service account of a Chat app (scope `chat.bot`): its token is asked
   * for once and shared until five minutes before its end.
   */
  readonly serviceAccount?: GoogleServiceAccount;
  /** @default "https://chat.googleapis.com" */
  readonly baseUrl?: string;
  /** @default "https://oauth2.googleapis.com/token" */
  readonly tokenUrl?: string;
  /**
   * The time a request may take, in milliseconds; 0 or `Infinity` for none.
   * @default 30000
   */
  readonly timeout?: number;
  /**
   * Retries of a request: a 429, a 5xx of the app, or a connection never
   * made; a message of the app after a lost answer too, under its request
   * id.  A webhook's after a 5xx, a timeout or a lost answer never: that
   * receipt is of unknown delivery.
   * @default 3
   */
  readonly retries?: number;
  /** The sends of `sendMany()` at once. @default 5 */
  readonly concurrency?: number;
  /** Header fields added to every request. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The clock of the token. @default Date.now */
  readonly now?: () => number;
}

/**
 * A transport of messages of Google Chat (`spaces.messages.create`).  A
 * message without `to` goes to the space of the webhook; one with `to`, a
 * space (`spaces/AAAA…`), through the Chat app, under a `requestId` of its
 * idempotency key, which the API answers again with the message it made.
 * Its text goes as it is, `<users/all>` and the mentions of users it does
 * not name in `mentions` broken; one picture by URL and link buttons are a
 * card; `thread` is the key of the thread it creates or replies in.
 * `payload` holds the fields of the message over those (`cardsV2`,
 * `accessoryWidgets`); a message over 32,000 bytes is refused before any
 * request.
 *
 * The receipt says `state: 'sent'`, the `name` of the message its id.  A
 * webhook deleted is `auth`; a space the app is not in `invalid-recipient`.
 *
 * @example
 * ```js
 * const { GoogleChatTransport } = require('@alexify/mailer/google-chat');
 * const chat = new GoogleChatTransport({ webhookUrl: process.env.GOOGLE_CHAT_WEBHOOK_URL });
 * ```
 */
export declare class GoogleChatTransport implements VerifiableTransport<
  'google-chat',
  GoogleChatMessage
> {
  readonly id = 'google-chat';
  constructor(config: GoogleChatConfig);
  send(message: GoogleChatMessage, options?: TransportOptions): Promise<Receipt<'google-chat'>>;
  sendMany(
    messages: Iterable<GoogleChatMessage> | AsyncIterable<GoogleChatMessage>,
    options?: TransportOptions,
  ): AsyncIterable<Receipt<'google-chat'>>;
  /** Verifies the account of the app by listing a space; a webhook alone verifies nothing. */
  verify(options?: TransportOptions): Promise<void>;
}
