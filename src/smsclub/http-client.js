// Not ported: the requests of the JSON API of SMS Club
// (https://smsclub.mobi/api), written from its documentation: the Bearer
// token, and the statuses of its refusals: 400 a request it did not
// validate, 401 the token, 429 its limit of 9 requests a second, and 453 an
// SMS sent twice within two minutes, the first of which went.

const { createApiClient } = require('../internal/api-client.js');

const STATUSES = new Map([
  [400, 'validation'],
  [401, 'auth'],
  [429, 'rate-limit'],
]);
// The same SMS within two minutes: one went, so this answer is of unknown
// delivery, never a refusal nor retried.
const DUPLICATE = 453;

/**
 * The category of a refusal of SMS Club, by its status.
 *
 * @internal
 */
const classifySmsClub = (status) => {
  const category = STATUSES.get(status) ?? (status >= 500 ? 'server-error' : undefined);
  return {
    category,
    retryable:
      category === undefined ? undefined : category === 'rate-limit' || category === 'server-error',
    code: `smsclub.http_${status}`,
  };
};

/**
 * The client of the JSON API.
 *
 * @internal
 */
const createSmsClubClient = (config) => {
  const client = createApiClient(config, {
    id: 'smsclub',
    label: 'SMS Club',
    authorize: (headers) => headers.set('Authorization', `Bearer ${config.token}`),
    classify: classifySmsClub,
    isAmbiguousStatus: (status) => status === DUPLICATE,
  });
  return {
    ...client,
    balanceUrl: `${config.baseUrl}/sms/balance`,
    send: (body, options) =>
      client.request({
        url: `${config.baseUrl}/sms/send`,
        body,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { createSmsClubClient };
