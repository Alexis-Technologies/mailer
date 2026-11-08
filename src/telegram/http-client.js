// Ported from @thinwrap/notifications v1.2.0 (src/providers/telegram/telegram.connector.ts):
// the requests of the Bot API and the categories of its errors by status and
// description.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Also ported from node-telegram-bot-api v2.1.0 (src/core/transport.ts): the
// envelope of an answer, `ok`, `error_code`, `description` and `parameters`
// (`retry_after`, `migrate_to_chat_id`).
// https://github.com/yagop/node-telegram-bot-api — MIT, Copyright 2019 Yago
// Changed in the port: through the shared client of the HTTP providers, so a
// redirect is not followed, the body is bounded, and a send is retried only
// after a 429 or a connection never made, never after a timeout or a 5xx,
// after which Telegram may have sent the message (TG1); a 403 says which of
// blocked and not on the channel it is, rather than an invalid recipient
// alike (T7).

const { createApiClient } = require('../internal/api-client.js');

// What a refusal of Telegram says, by its description, where its status says
// less: the Bot API has no codes beyond the HTTP status. Each is a code of
// the receipt and a category.
const FORBIDDEN = [
  [/bot can't initiate conversation/i, 'not_started', 'not-on-channel'],
  [/bot can't send messages to bots/i, 'bot_recipient', 'invalid-recipient'],
  [/user is deactivated/i, 'deactivated', 'invalid-recipient'],
  [/bot was kicked|bot is not a member|bot was blocked/i, 'blocked', 'blocked'],
];
const BAD_REQUEST = [
  [/upgraded to a supergroup/i, 'migrated', 'invalid-recipient'],
  [
    /chat not found|user not found|peer_id_invalid|user_id_invalid|chat_id_invalid/i,
    'chat_not_found',
    'invalid-recipient',
  ],
  [
    /not enough rights|have no rights|chat_write_forbidden|need administrator rights/i,
    'no_rights',
    'blocked',
  ],
  [
    /too long|too many|is empty|wrong file|failed to get http url content|can't parse entities/i,
    'invalid',
    'validation',
  ],
];

const matchOf = (table, description) => {
  for (const [pattern, code, category] of table) {
    if (pattern.test(description)) return { code: `telegram.${code}`, category };
  }
  return undefined;
};

/**
 * The category of a refusal of the Bot API, from its status (the
 * `error_code` of its body, or of the answer) and its description:
 * `{ category, retryable, code, retryAfterMilliseconds }`.
 *
 * @internal
 */
const classifyTelegram = (status, json) => {
  const code = typeof json?.error_code === 'number' ? json.error_code : status;
  const description = typeof json?.description === 'string' ? json.description : '';
  const parameters = json?.parameters;
  if (code === 429) {
    const seconds = parameters?.retry_after;
    return {
      category: 'rate-limit',
      retryable: true,
      code: 'telegram.too_many_requests',
      retryAfterMilliseconds: Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined,
    };
  }
  // A bad token is a 401; a path of no bot, a 404.
  if (code === 401 || code === 404) {
    return { category: 'auth', retryable: false, code: 'telegram.unauthorized' };
  }
  if (code === 403) {
    return {
      ...(matchOf(FORBIDDEN, description) ?? { code: 'telegram.forbidden', category: 'blocked' }),
      retryable: false,
    };
  }
  if (code === 400 && parameters?.migrate_to_chat_id !== undefined) {
    return { category: 'invalid-recipient', retryable: false, code: 'telegram.migrated' };
  }
  if (code === 400) {
    return {
      ...(matchOf(BAD_REQUEST, description) ?? {
        code: 'telegram.bad_request',
        category: 'validation',
      }),
      retryable: false,
    };
  }
  if (code >= 500) {
    return { category: 'server-error', retryable: false, code: 'telegram.server_error' };
  }
  return undefined;
};

/**
 * The client of the Bot API: a method of the bot, with the token in its
 * path.
 *
 * @internal
 */
const createTelegramClient = (config) => {
  const client = createApiClient(config, {
    id: 'telegram',
    label: 'Telegram',
    // The token is in the path: no header carries it.
    authorize: () => {},
    messageOf: (json) => (typeof json?.description === 'string' ? json.description : undefined),
    classify: classifyTelegram,
    // A 5xx of the Bot API may come once the message went (TG1).
    isAmbiguousStatus: (status) => status >= 500,
  });
  const urlOf = (method) => `${config.baseUrl}/bot${config.botToken}/${method}`;
  return {
    ...client,
    urlOf,
    /**
     * Calls a method of the bot with its body: JSON, or FormData with files.
     */
    call: (method, body, options) =>
      client.request({
        url: urlOf(method),
        body,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { classifyTelegram, createTelegramClient };
