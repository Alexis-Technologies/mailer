// Not ported: the request of phones.agentMessages.create of the RCS Business
// Messaging API, written from its documentation, as
// @google/rcsbusinessmessaging is Apache-2.0: the `messageId` of the client in the query, which the API
// refuses twice with ALREADY_EXISTS, so a send is retried under it after a
// lost answer; the token of the service account shared with ./fcm's
// (internal/google-auth.js) and dropped when the API refuses it.

const { createApiClient } = require('../internal/api-client.js');
const { createGoogleAuth } = require('../internal/google-auth.js');

const SCOPES = ['https://www.googleapis.com/auth/rcsbusinessmessaging'];
// The status of a google.rpc.Status. A user without RCS, or out of reach of
// the agent's carriers, is NOT_FOUND: the message falls back to SMS.
const STATUSES = new Map([
  ['NOT_FOUND', 'not-on-channel'],
  ['PERMISSION_DENIED', 'configuration'],
  ['UNAUTHENTICATED', 'auth'],
  ['INVALID_ARGUMENT', 'validation'],
  ['FAILED_PRECONDITION', 'validation'],
  ['RESOURCE_EXHAUSTED', 'rate-limit'],
  ['UNAVAILABLE', 'service-unavailable'],
  ['INTERNAL', 'server-error'],
]);
const HTTP_STATUSES = new Map([
  [400, 'validation'],
  [401, 'auth'],
  [403, 'configuration'],
  [404, 'not-on-channel'],
  [429, 'rate-limit'],
]);
const RETRYABLE = new Set(['rate-limit', 'server-error', 'service-unavailable']);

/**
 * The category of a refusal of the API: by the status of its error, then
 * its HTTP status.
 *
 * @internal
 */
const classifyRbm = (status, json) => {
  const named = typeof json?.error?.status === 'string' ? json.error.status : undefined;
  const category =
    STATUSES.get(named) ??
    HTTP_STATUSES.get(status) ??
    (status >= 500 ? 'server-error' : undefined);
  return {
    category,
    retryable: category === undefined ? undefined : RETRYABLE.has(category),
    code: `rbm.${named ?? `http_${status}`}`,
  };
};

/**
 * The client of the messages of an agent, with the token of its account.
 *
 * @internal
 */
const createRbmClient = (config) => {
  const auth = createGoogleAuth({
    serviceAccount: config.serviceAccount,
    scopes: SCOPES,
    fetch: (url, init) => (config.fetch ?? globalThis.fetch)(url, init),
    tokenUrl: config.tokenUrl,
    now: config.now,
  });
  // A token the API refuses is dropped, so that the next send asks for another.
  const fetch = async (url, init) => {
    const response = await (config.fetch ?? globalThis.fetch)(url, init);
    if (response.status === 401) {
      const token = new Headers(init.headers).get('authorization')?.slice('Bearer '.length);
      if (token !== undefined) auth.invalidate(token);
    }
    return response;
  };
  const client = createApiClient(
    { ...config, fetch },
    {
      id: 'rbm',
      label: 'RBM',
      authorize: async (headers, { signal }) => {
        headers.set('Authorization', `Bearer ${await auth.token(signal)}`);
      },
      messageOf: (json) =>
        typeof json?.error?.message === 'string' ? json.error.message : undefined,
      classify: classifyRbm,
    },
  );
  const agent = encodeURIComponent(config.agentId);
  return {
    ...client,
    send: (to, messageId, body, options) =>
      client.request({
        url:
          `${config.baseUrl}/v1/phones/${to}/agentMessages` +
          `?messageId=${encodeURIComponent(messageId)}&agentId=${agent}`,
        body,
        // The API refuses a messageId it has with ALREADY_EXISTS rather than
        // sending it again.
        hasIdempotencyKey: true,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { classifyRbm, createRbmClient };
