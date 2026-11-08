// Not ported: the requests of the REST Bot API of Viber, written from its
// documentation (https://developers.viber.com/docs/api/rest-bot-api/), as
// viber-bot is Apache-2.0: the X-Viber-Auth-Token of the bot, an answer of
// 200 whose `status` says whether the message went, and its
// `message_token`, a 64-bit integer, read from the text of the answer, where
// viber-bot parsed it as a number and lost its last digits (VB2).

const { createApiClient } = require('../internal/api-client.js');

// The status of an answer (https://developers.viber.com/docs/api/rest-bot-api/#error-codes).
const STATUSES = new Map([
  [1, 'validation'],
  [2, 'auth'],
  [3, 'validation'],
  [4, 'validation'],
  [5, 'not-on-channel'],
  [6, 'not-on-channel'],
  [7, 'configuration'],
  [8, 'configuration'],
  [9, 'configuration'],
  [10, 'configuration'],
  [11, 'not-on-channel'],
  [12, 'rate-limit'],
  [13, 'validation'],
  [14, 'validation'],
  [15, 'configuration'],
  [21, 'configuration'],
  [23, 'configuration'],
  [24, 'configuration'],
]);
const MESSAGE_TOKEN = /"message_token"\s*:\s*"?(\d{1,24})"?/;

/**
 * The category of the status of an answer, `rejected` for one Viber does not
 * document.
 *
 * @internal
 */
const classifyStatus = (status) => {
  const category = STATUSES.get(status) ?? 'rejected';
  return { category, retryable: category === 'rate-limit', code: `viber.${status}` };
};

// The answer, with the token of the message as the text wrote it.
const readAnswer = (response, text) => {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return {
    status: response.status,
    headers: response.headers,
    json,
    messageToken: MESSAGE_TOKEN.exec(text)?.[1],
  };
};

/**
 * The client of the bot.
 *
 * @internal
 */
const createViberClient = (config) => {
  const client = createApiClient(config, {
    id: 'viber',
    label: 'Viber',
    authorize: (headers) => headers.set('X-Viber-Auth-Token', config.authToken),
    messageOf: (json) =>
      typeof json?.status_message === 'string' ? json.status_message : undefined,
  });
  return {
    ...client,
    accountUrl: `${config.baseUrl}/pa/get_account_info`,
    send: (body, options) =>
      client.request({
        url: `${config.baseUrl}/pa/send_message`,
        body,
        read: readAnswer,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { classifyStatus, createViberClient };
