// Ported from @thinwrap/notifications v1.2.0 (src/providers/slack/slack.connector.ts):
// the request of an incoming webhook, its answer `ok` in plain text, and the
// categories of its statuses.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: through the shared client of the HTTP providers, so a
// redirect is not followed and the body is bounded; chat.postMessage of the
// Web API beside the webhook, its `ok: false` read by its `error`; and a send
// is never retried after a network failure, a 5xx or a `fatal_error`, after
// which Slack may have posted it (SL1, @slack/web-api `WebClient.ts`).

const { parseRetryAfter } = require('../core/receipt.js');
const { ProviderApiError, createApiClient } = require('../internal/api-client.js');

// What an `error` of Slack says, of the Web API in a 200 or of a webhook in
// its text: a category, and whether Slack may have posted the message
// (`unknown`).
const ERRORS = new Map([
  ['channel_not_found', 'invalid-recipient'],
  ['user_not_found', 'invalid-recipient'],
  ['is_archived', 'invalid-recipient'],
  ['channel_is_archived', 'invalid-recipient'],
  ['not_in_channel', 'not-on-channel'],
  ['restricted_action', 'blocked'],
  ['restricted_action_read_only_channel', 'blocked'],
  ['restricted_action_thread_only_channel', 'blocked'],
  ['restricted_action_non_threadable_channel', 'blocked'],
  ['action_prohibited', 'blocked'],
  ['ekm_access_denied', 'blocked'],
  ['msg_too_long', 'validation'],
  ['no_text', 'validation'],
  ['invalid_blocks', 'validation'],
  ['invalid_blocks_format', 'validation'],
  ['invalid_attachments', 'validation'],
  ['too_many_attachments', 'validation'],
  ['invalid_arguments', 'validation'],
  ['invalid_payload', 'validation'],
  ['invalid_json', 'validation'],
  ['json_not_object', 'validation'],
  ['cannot_reply_to_message', 'validation'],
  ['not_authed', 'auth'],
  ['invalid_auth', 'auth'],
  ['invalid_token', 'auth'],
  ['account_inactive', 'auth'],
  ['token_revoked', 'auth'],
  ['token_expired', 'auth'],
  ['no_service', 'auth'],
  ['no_team', 'auth'],
  ['missing_scope', 'configuration'],
  ['no_permission', 'configuration'],
  ['not_allowed_token_type', 'configuration'],
  ['team_access_not_granted', 'configuration'],
  ['access_denied', 'configuration'],
  ['ratelimited', 'rate-limit'],
  ['rate_limited', 'rate-limit'],
  ['service_unavailable', 'service-unavailable'],
  ['fatal_error', 'unknown'],
  ['internal_error', 'unknown'],
  ['request_timeout', 'unknown'],
  ['rollup_error', 'unknown'],
]);
const RETRYABLE = new Set(['rate-limit', 'service-unavailable']);

/**
 * The category of an `error` of Slack: `{ category, retryable, code,
 * unknown }`, `unknown` when Slack may have posted the message.
 *
 * @internal
 */
const classifySlackError = (error, status) => {
  const named = typeof error === 'string' ? ERRORS.get(error) : undefined;
  let category = named;
  if (category === undefined) {
    if (status === 429) category = 'rate-limit';
    else if (status === 401 || status === 403) category = 'auth';
    else if (status >= 500) category = 'unknown';
    else category = 'validation';
  }
  return {
    category: category === 'unknown' ? 'server-error' : category,
    retryable: RETRYABLE.has(category),
    code: `slack.${typeof error === 'string' && error !== '' ? error : `http_${status}`}`,
    unknown: category === 'unknown',
  };
};

// The error of a refused request of a webhook, whose body is its error in
// plain text.
const webhookRejection = (response, text, attempt) => {
  const error = (text ?? '').trim();
  const classified = classifySlackError(error, response.status);
  return new ProviderApiError(
    'slack',
    `Slack: ${error === '' ? `HTTP ${response.status}` : error}`,
    {
      statusCode: response.status,
      retryAfterMilliseconds: parseRetryAfter(response.headers.get('Retry-After')),
      attempts: attempt + 1,
      category: classified.category,
      retryable: classified.retryable,
      code: classified.code,
    },
  );
};

/**
 * The clients of Slack: the Web API with the token of the bot, and the
 * incoming webhook, its URL the credential.
 *
 * @internal
 */
const createSlackClient = (config) => {
  const isApi = (url) => url.startsWith(`${config.baseUrl}/`);
  const client = createApiClient(config, {
    id: 'slack',
    label: 'Slack',
    // Only a request of the Web API carries the token; a webhook is its URL.
    authorize: (headers, { url }) => {
      if (isApi(url)) headers.set('Authorization', `Bearer ${config.botToken}`);
    },
    messageOf: (json) => (typeof json?.error === 'string' ? json.error : undefined),
    classify: (status, json) => {
      const { unknown: _unknown, ...classified } = classifySlackError(json?.error, status);
      return classified;
    },
    // A 5xx of Slack may come once the message was posted (SL1).
    isAmbiguousStatus: (status) => status >= 500,
  });
  const webhook = createApiClient(config, {
    id: 'slack',
    label: 'Slack',
    authorize: () => {},
    reject: webhookRejection,
    isAmbiguousStatus: (status) => status >= 500,
  });
  return {
    ...client,
    urlOf: (method) => `${config.baseUrl}/${method}`,
    /** Calls a method of the Web API with a body of JSON. */
    call: (method, body, options) =>
      client.request({
        url: `${config.baseUrl}/${method}`,
        body,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
    /** Posts to the incoming webhook, whose answer is `ok` in plain text. */
    post: (body, options) =>
      webhook.request({
        url: config.webhookUrl,
        body,
        signal: options?.signal,
        onRetry: options?.onRetry,
        read: (response, text) => ({ status: response.status, text }),
      }),
  };
};

module.exports = { classifySlackError, createSlackClient };
