// Ported from @thinwrap/notifications v1.2.0 (src/providers/discord/discord.connector.ts):
// the request of a webhook with `?wait=true`, so that Discord answers with
// the message, `thread_id` in its query, and the categories of its statuses.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: through the shared client of the HTTP providers, so a
// redirect is not followed and the body is bounded; the REST API of a bot
// beside the webhook, its errors read by their codes; a 429 counts as an
// attempt and waits its `retry_after`, and a send of a bot carries a nonce
// that Discord enforces, so that it is retried safely after a timeout or a
// 5xx, after which a webhook, which takes none, is of unknown delivery
// (DC1, discord.js `SequentialHandler.ts`, `utils.ts`).

const { createApiClient } = require('../internal/api-client.js');
const { RateLimitBuckets } = require('./buckets.js');

// What a JSON error code of Discord says
// (https://discord.com/developers/docs/topics/opcodes-and-status-codes#json).
const CODES = new Map([
  [10003, 'invalid-recipient'],
  [10013, 'invalid-recipient'],
  [50083, 'invalid-recipient'],
  [10015, 'auth'],
  [50001, 'blocked'],
  [50007, 'blocked'],
  [50013, 'blocked'],
  [10008, 'validation'],
  [50006, 'validation'],
  [50035, 'validation'],
  [40005, 'validation'],
]);
const STATUSES = new Map([
  [400, 'validation'],
  [401, 'auth'],
  [403, 'blocked'],
  [404, 'invalid-recipient'],
  [413, 'validation'],
]);

/**
 * The category of a refusal of Discord, by its JSON code, then its status.
 *
 * @internal
 */
const classifyDiscord = (status, json) => {
  if (status === 429) {
    const seconds = json?.retry_after;
    return {
      category: 'rate-limit',
      retryable: true,
      code: json?.global === true ? 'discord.global_rate_limit' : 'discord.rate_limit',
      retryAfterMilliseconds:
        Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : undefined,
    };
  }
  const code = typeof json?.code === 'number' && json.code !== 0 ? json.code : undefined;
  const category = CODES.get(code) ?? STATUSES.get(status);
  if (category !== undefined) {
    return { category, retryable: false, code: `discord.${code ?? `http_${status}`}` };
  }
  if (status >= 500) {
    return { category: 'server-error', retryable: true, code: `discord.http_${status}` };
  }
  return undefined;
};

// A request of a client, under a nonce or not.
const request = (client, url, body, options, hasIdempotencyKey) =>
  client.request({
    url,
    body,
    signal: options?.signal,
    onRetry: options?.onRetry,
    hasIdempotencyKey,
  });

// The route of a URL, the key of its bucket: its path, without the query
// that a webhook takes `wait` and `thread_id` in.
const routeOf = (url) => {
  const at = url.indexOf('?');
  return at === -1 ? url : url.slice(0, at);
};

/**
 * The clients of Discord: the REST API with the token of the bot, and the
 * webhook, its URL the credential; and the buckets of their routes.
 *
 * @internal
 */
const createDiscordClient = (config) => {
  const buckets = new RateLimitBuckets();
  // The fetch of the transport, read at each request, whose answers tell the
  // buckets; the wait for one happens before the request, out of its
  // deadline.
  const fetch = async (url, init) => {
    const response = await (config.fetch ?? globalThis.fetch)(url, init);
    buckets.update(routeOf(url), response.headers);
    return response;
  };
  const shared = {
    label: 'Discord',
    id: 'discord',
    messageOf: (json) => (typeof json?.message === 'string' ? json.message : undefined),
    classify: classifyDiscord,
    isAmbiguousStatus: (status) => status >= 500,
  };
  const api = createApiClient(
    { ...config, fetch },
    {
      ...shared,
      authorize: (headers, { url }) => {
        if (url.startsWith(`${config.baseUrl}/`)) {
          headers.set('Authorization', `Bot ${config.botToken}`);
        }
      },
    },
  );
  const webhook = createApiClient({ ...config, fetch }, { ...shared, authorize: () => {} });
  return {
    ...api,
    buckets,
    routeOf,
    /** The URL of the messages of a channel. */
    channelUrl: (channelId) =>
      `${config.baseUrl}/channels/${encodeURIComponent(channelId)}/messages`,
    /** The URL of the webhook, with its query of the send. */
    webhookUrl: (query) => {
      const url = new URL(config.webhookUrl);
      for (const name in query) url.searchParams.set(name, query[name]);
      return url.toString();
    },
    /** Creates a message of a bot, under the nonce Discord enforces. */
    create: (url, body, options) => request(api, url, body, options, true),
    /** Executes the webhook, which takes no nonce. */
    execute: (url, body, options) => request(webhook, url, body, options, false),
  };
};

module.exports = { classifyDiscord, createDiscordClient };
