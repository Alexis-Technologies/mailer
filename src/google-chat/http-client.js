// Not ported: the requests of spaces.messages.create of the Google Chat API,
// written from its documentation: a webhook, its URL with its key and token
// the credential, and a Chat app, with the token of its service account
// (internal/google-auth.js, as ./fcm and ./rbm share it) and a `requestId`,
// which the API answers again with the message it made under it, so a send
// of the app is retried after a lost answer.

const { createApiClient } = require('../internal/api-client.js');
const { createGoogleAuth } = require('../internal/google-auth.js');

const SCOPES = ['https://www.googleapis.com/auth/chat.bot'];
const STATUSES = new Map([
  ['INVALID_ARGUMENT', 'validation'],
  ['FAILED_PRECONDITION', 'validation'],
  ['UNAUTHENTICATED', 'auth'],
  ['RESOURCE_EXHAUSTED', 'rate-limit'],
  ['UNAVAILABLE', 'service-unavailable'],
  ['INTERNAL', 'server-error'],
]);
// A webhook is its URL: a refused or deleted one is its credential refused.
const WEBHOOK_STATUSES = new Map([
  [400, 'validation'],
  [401, 'auth'],
  [403, 'auth'],
  [404, 'auth'],
  [429, 'rate-limit'],
]);
const APP_STATUSES = new Map([
  [400, 'validation'],
  [401, 'auth'],
  [403, 'configuration'],
  [404, 'invalid-recipient'],
  [429, 'rate-limit'],
]);
const RETRYABLE = new Set(['rate-limit', 'server-error', 'service-unavailable']);

const classifyWith = (statuses) => (status, json) => {
  const named = typeof json?.error?.status === 'string' ? json.error.status : undefined;
  const category =
    statuses.get(status) ?? STATUSES.get(named) ?? (status >= 500 ? 'server-error' : undefined);
  return {
    category,
    retryable: category === undefined ? undefined : RETRYABLE.has(category),
    code: `google-chat.${named ?? `http_${status}`}`,
  };
};

const messageOf = (json) =>
  typeof json?.error?.message === 'string' ? json.error.message : undefined;

// The query of a reply in a thread, a new one when the key names none.
const replyOption = (body) =>
  body.thread === undefined ? '' : '&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD';

/**
 * The clients of Google Chat: the webhook and the app.
 *
 * @internal
 */
const createGoogleChatClient = (config) => {
  const auth =
    config.serviceAccount === undefined
      ? undefined
      : createGoogleAuth({
          serviceAccount: config.serviceAccount,
          scopes: SCOPES,
          fetch: (url, init) => (config.fetch ?? globalThis.fetch)(url, init),
          tokenUrl: config.tokenUrl,
          now: config.now,
        });
  // A token the API refuses is dropped, so that the next send asks for another.
  const fetch = async (url, init) => {
    const response = await (config.fetch ?? globalThis.fetch)(url, init);
    if (response.status === 401 && auth !== undefined) {
      const token = new Headers(init.headers).get('authorization')?.slice('Bearer '.length);
      if (token !== undefined) auth.invalidate(token);
    }
    return response;
  };
  const app = createApiClient(
    { ...config, fetch },
    {
      id: 'google-chat',
      label: 'Google Chat',
      authorize: async (headers, { signal }) => {
        headers.set('Authorization', `Bearer ${await auth.token(signal)}`);
      },
      messageOf,
      classify: classifyWith(APP_STATUSES),
      // A 5xx may come once the message was posted: retried under the
      // requestId, its last failure of unknown delivery.
      isAmbiguousStatus: (status) => status >= 500,
    },
  );
  const webhook = createApiClient(config, {
    id: 'google-chat',
    label: 'Google Chat',
    authorize: () => {},
    messageOf,
    classify: classifyWith(WEBHOOK_STATUSES),
    // A 5xx may come once the message was posted, and a webhook takes no key.
    isAmbiguousStatus: (status) => status >= 500,
  });
  return {
    ...app,
    spacesUrl: `${config.baseUrl}/v1/spaces?pageSize=1`,
    /** Posts a message of the app to a space, under its request id. */
    post: (space, requestId, body, options) =>
      app.request({
        url:
          `${config.baseUrl}/v1/${space}/messages?requestId=${encodeURIComponent(requestId)}` +
          replyOption(body),
        body,
        hasIdempotencyKey: true,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
    /** Posts a message to the space of the webhook. */
    postWebhook: (body, options) => {
      const option = replyOption(body);
      return webhook.request({
        url:
          option === '' || config.webhookUrl.includes('?')
            ? `${config.webhookUrl}${option}`
            : `${config.webhookUrl}?${option.slice(1)}`,
        body,
        signal: options?.signal,
        onRetry: options?.onRetry,
      });
    },
  };
};

module.exports = { createGoogleChatClient };
