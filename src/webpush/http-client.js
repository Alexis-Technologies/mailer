// Not ported: the client of the push services of Web Push (RFC 8030): a push
// to the endpoint of a subscription, with the VAPID of the application, and
// the categories of its answers: a subscription gone (404, 410) is
// `unregistered`, a body too large (413) `validation`, a VAPID refused (401,
// 403) `auth` (V14: visulima classified none of them).

const { createApiClient } = require('../internal/api-client.js');
const { createVapid } = require('./vapid.js');

const STATUSES = new Map([
  [400, ['validation', 'webpush.bad_request']],
  [401, ['auth', 'webpush.unauthorized']],
  [403, ['auth', 'webpush.forbidden']],
  [404, ['unregistered', 'webpush.not_found']],
  [410, ['unregistered', 'webpush.gone']],
  [413, ['validation', 'webpush.too_large']],
]);

/**
 * The category of an answer of a push service.
 *
 * @internal
 */
const classifyWebPush = (status) => {
  const named = STATUSES.get(status);
  return named === undefined ? undefined : { category: named[0], retryable: false, code: named[1] };
};

/**
 * The client of the push services.
 *
 * @internal
 */
const createWebPushClient = (config) => {
  const authorizationOf = createVapid(config.vapid, config.now);
  const client = createApiClient(config, {
    id: 'webpush',
    label: 'Web Push',
    authorize: (headers, { url }) => headers.set('Authorization', authorizationOf(url)),
    classify: classifyWebPush,
  });
  return {
    ...client,
    /** Pushes an encrypted body to an endpoint; the answer is its headers. */
    push: (endpoint, body, headers, options) =>
      client.request({
        url: endpoint,
        body,
        headers,
        signal: options?.signal,
        onRetry: options?.onRetry,
        read: (response) => ({ status: response.status, headers: response.headers }),
      }),
  };
};

module.exports = { classifyWebPush, createWebPushClient };
