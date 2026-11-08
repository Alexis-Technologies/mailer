// Not ported: the requests of the JSON API of AlphaSMS
// (https://docs.alphasms.ua/ru/api/json/), written from its documentation:
// the key in the `auth` of the body, and an answer of 200 whose `success`,
// then that of its item, says whether the message went, an error told by
// its words alone, as the API gives no codes.

const { createApiClient } = require('../internal/api-client.js');

// The words of an error, and what they say.
const ERRORS = [
  [/access denied/i, 'auth'],
  [/alpha-?name|signature|sender/i, 'configuration'],
  [/money|balance/i, 'configuration'],
  [/phone|number/i, 'invalid-recipient'],
];

/**
 * The category of an error of AlphaSMS by its words, `rejected` for one
 * they do not tell.
 *
 * @internal
 */
const classifyError = (error) => {
  const text = typeof error === 'string' ? error : '';
  for (const [words, category] of ERRORS) {
    if (words.test(text)) return { category, retryable: false, code: 'alphasms.error' };
  }
  return { category: 'rejected', retryable: false, code: 'alphasms.error' };
};

/**
 * The client of the JSON API.
 *
 * @internal
 */
const createAlphaSmsClient = (config) => {
  const client = createApiClient(config, {
    id: 'alphasms',
    label: 'AlphaSMS',
    // The key goes in the body of each request.
    authorize: () => {},
    messageOf: (json) => (typeof json?.error === 'string' ? json.error : undefined),
  });
  const url = `${config.baseUrl}/api/json.php`;
  return {
    ...client,
    url,
    send: (item, options) =>
      client.request({
        url,
        body: { auth: config.apiKey, data: [item] },
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { classifyError, createAlphaSmsClient };
