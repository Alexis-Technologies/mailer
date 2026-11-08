// Not ported: the requests of the HTTP API of TurboSMS
// (https://turbosms.ua/api.html), written from its documentation: the Bearer
// token, an answer of 200 whose `response_code` says what happened, and the
// `sequence_id` of a request, which TurboSMS executes once in 30 days, so a
// send is retried after a lost answer as the same request.

const { createApiClient } = require('../internal/api-client.js');

// The codes of an answer, by what they say.
const CODES = new Map([
  [103, 'auth'],
  [105, 'auth'],
  [301, 'auth'],
  [106, 'configuration'],
  [107, 'configuration'],
  [203, 'configuration'],
  [302, 'configuration'],
  [309, 'configuration'],
  [319, 'configuration'],
  [320, 'configuration'],
  [400, 'configuration'],
  [401, 'configuration'],
  [406, 'configuration'],
  [415, 'configuration'],
  [416, 'configuration'],
  [424, 'configuration'],
  [425, 'configuration'],
  [426, 'configuration'],
  [434, 'configuration'],
  [305, 'invalid-recipient'],
  [318, 'invalid-recipient'],
  [404, 'opted-out'],
  [428, 'rate-limit'],
  [436, 'rate-limit'],
  [437, 'rate-limit'],
  [438, 'rate-limit'],
  [500, 'server-error'],
  [502, 'server-error'],
  [503, 'server-error'],
  [504, 'server-error'],
]);
const RETRYABLE = new Set(['rate-limit', 'server-error']);

/**
 * The category of a code of TurboSMS: those it names, `validation` for the
 * other 2xx, 3xx and 4xx of a request it refused, `rejected` past them.
 *
 * @internal
 */
const classifyCode = (code) => {
  let category = CODES.get(code);
  if (category === undefined) category = code >= 200 && code < 500 ? 'validation' : 'rejected';
  return { category, retryable: RETRYABLE.has(category), code: `turbosms.${code}` };
};

/**
 * The client of the HTTP API.
 *
 * @internal
 */
const createTurboSmsClient = (config) => {
  const client = createApiClient(config, {
    id: 'turbosms',
    label: 'TurboSMS',
    authorize: (headers) => headers.set('Authorization', `Bearer ${config.token}`),
    messageOf: (json) =>
      typeof json?.response_status === 'string' ? json.response_status : undefined,
  });
  return {
    ...client,
    balanceUrl: `${config.baseUrl}/user/balance.json`,
    send: (body, options) =>
      client.request({
        url: `${config.baseUrl}/message/send.json`,
        body,
        // TurboSMS answers a sequence_id it executed with its results, and
        // FAILED_DUPLICATE_REQUEST, rather than sending again.
        hasIdempotencyKey: true,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { classifyCode, createTurboSmsClient };
