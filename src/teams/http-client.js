// Ported from @thinwrap/notifications v1.2.0 (src/providers/ms-teams/ms-teams.connector.ts):
// the post to a webhook of Teams, which a webhook of Workflows answers 202 and
// one of the Office 365 connectors 200 with `1`, or with the error it met
// (`failureStatusFor2xx`), and a webhook refused as `Invalid webhook URL`.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Also the requests of a bot to the Connector API of the Bot Framework
// (`/v3/conversations/<id>/activities`), written from its documentation: the
// token of the app, and a service URL held to those of Teams, as the token
// goes to it. Changed in the port: through the shared client, so a redirect
// is not followed, the body is bounded, and a 5xx, after which a flow may
// have run, is of unknown delivery, never retried.

const { parseRetryAfter } = require('../core/receipt.js');
const { createApiClient, ProviderApiError } = require('../internal/api-client.js');
const { createBotAuth } = require('./bot-auth.js');
const { fetchDroppingRefused } = require('../internal/token-failure.js');

// The hosts of the service URLs of Teams: commercial, GCC, GCC High, DoD.
const SERVICE_HOSTS = new Set([
  'smba.trafficmanager.net',
  'smba.infra.gcc.teams.microsoft.com',
  'smba.infra.gov.teams.microsoft.us',
  'smba.infra.dod.teams.microsoft.us',
]);
const CODES = new Map([
  ['BotNotInConversationRoster', 'blocked'],
  ['ConversationNotFound', 'invalid-recipient'],
  ['ConversationBlockedByUser', 'blocked'],
]);
const BOT_STATUSES = new Map([
  [400, 'validation'],
  [401, 'auth'],
  [403, 'configuration'],
  [404, 'invalid-recipient'],
  [413, 'validation'],
  [429, 'rate-limit'],
]);
const WEBHOOK_STATUSES = new Map([
  [401, 'auth'],
  [403, 'auth'],
  [404, 'auth'],
  [413, 'validation'],
  [429, 'rate-limit'],
]);

const classifyBot = (status, json) => {
  const code = typeof json?.error?.code === 'string' ? json.error.code : undefined;
  const category =
    CODES.get(code) ?? BOT_STATUSES.get(status) ?? (status >= 500 ? 'server-error' : undefined);
  return {
    category,
    retryable: category === undefined ? undefined : category === 'rate-limit',
    code: `teams.${code ?? `http_${status}`}`,
  };
};

/**
 * The category of a refusal of a webhook, by its status; a revoked or
 * mistyped URL is a 400 that says `Invalid webhook URL`.
 *
 * @internal
 */
const classifyWebhook = (status, text) => {
  const category =
    status === 400 && /invalid webhook/i.test(text)
      ? 'auth'
      : (WEBHOOK_STATUSES.get(status) ?? (status >= 500 ? 'server-error' : 'validation'));
  return { category, retryable: category === 'rate-limit', code: `teams.http_${status}` };
};

const webhookRejection = (response, text, attempt) => {
  const body = (text ?? '').trim();
  const classified = classifyWebhook(response.status, body);
  return new ProviderApiError(
    'teams',
    `Teams: ${body === '' ? `HTTP ${response.status}` : body.slice(0, 200)}`,
    {
      statusCode: response.status,
      retryAfterMilliseconds: parseRetryAfter(response.headers.get('Retry-After')),
      attempts: attempt + 1,
      ...classified,
    },
  );
};

/**
 * Whether the token of the bot may go to a service URL: one of Teams, or of
 * the origins of `serviceUrls`.
 *
 * @internal
 */
const isServiceUrl = (config, serviceUrl) => {
  let url;
  try {
    url = new URL(serviceUrl);
  } catch {
    return false;
  }
  return (
    (url.protocol === 'https:' && SERVICE_HOSTS.has(url.hostname)) ||
    config.serviceOrigins.has(url.origin)
  );
};

/**
 * The clients of Teams: the webhook, its URL the credential, and the bot,
 * with the token of its app.
 *
 * @internal
 */
const createTeamsClient = (config) => {
  const auth = config.bot === undefined ? undefined : createBotAuth(config);
  // A token the Connector API refuses is dropped, so that the next send asks
  // for another.
  const fetch = fetchDroppingRefused(config.fetch, auth);
  const bot = createApiClient(
    { ...config, fetch },
    {
      refreshesToken: auth !== undefined,
      id: 'teams',
      label: 'Teams',
      authorize: async (headers, { signal }) => {
        headers.set('Authorization', `Bearer ${await auth.token(signal)}`);
      },
      messageOf: (json) =>
        typeof json?.error?.message === 'string' ? json.error.message : undefined,
      classify: classifyBot,
      isAmbiguousStatus: (status) => status >= 500,
    },
  );
  const webhook = createApiClient(config, {
    id: 'teams',
    label: 'Teams',
    authorize: () => {},
    reject: webhookRejection,
    isAmbiguousStatus: (status) => status >= 500,
  });
  return {
    ...bot,
    // The token of the bot, which Microsoft makes only for the secret of its
    // app: what verify() can check without sending.
    token: auth === undefined ? undefined : (signal) => auth.token(signal),
    isServiceUrl: (serviceUrl) => isServiceUrl(config, serviceUrl),
    /** Posts an activity to a conversation of the bot. */
    post: (to, body, options) => {
      const base = to.serviceUrl.endsWith('/') ? to.serviceUrl : `${to.serviceUrl}/`;
      return bot.request({
        url: `${base}v3/conversations/${encodeURIComponent(to.conversationId)}/activities`,
        body,
        signal: options?.signal,
        onRetry: options?.onRetry,
      });
    },
    /** Posts an activity to the webhook, whose answer is text or nothing. */
    postWebhook: (body, options) =>
      webhook.request({
        url: config.webhookUrl,
        body,
        signal: options?.signal,
        onRetry: options?.onRetry,
        read: (response, text) => ({ status: response.status, text }),
      }),
  };
};

module.exports = { classifyWebhook, createTeamsClient };
