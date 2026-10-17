// Ported from unemail v0.7.0 (src/drivers/postmark.ts): the requests of the
// Postmark API and the category of its error codes.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: through the shared client of the HTTP providers, so a
// redirect is not followed, the body is bounded, and a failure after Postmark
// may have taken the message is of unknown delivery rather than retried.

const { createApiClient } = require('../internal/api.js');

// What an ErrorCode of Postmark says, where it says more than its status.
const ERROR_CODES = new Map([
  [10, { category: 'auth', retryable: false }],
  [300, { category: 'validation', retryable: false }],
  [400, { category: 'configuration', retryable: false }],
  [401, { category: 'configuration', retryable: false }],
  [405, { category: 'configuration', retryable: false }],
  [406, { category: 'rejected', retryable: false }],
]);

/**
 * The category of a Postmark ErrorCode, a non-retryable `validation` for one
 * it does not name.
 *
 * @internal
 */
const classifyErrorCode = (errorCode) =>
  ERROR_CODES.get(errorCode) ?? { category: 'validation', retryable: false };

/**
 * The client of the Postmark API.
 *
 * @internal
 */
const createPostmarkClient = (config) => {
  const client = createApiClient(config, {
    id: 'postmark',
    label: 'Postmark',
    authorize: (headers) => headers.set('X-Postmark-Server-Token', config.serverToken),
    classify: (status, json) => {
      const code = json?.ErrorCode;
      if (typeof code !== 'number' || code === 0) return undefined;
      return { ...classifyErrorCode(code), code: `postmark.${code}` };
    },
  });
  return {
    ...client,
    send: (payload, options) =>
      client.request({
        url: `${config.baseUrl}/email`,
        body: payload,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
    sendBatch: (payloads, options) =>
      client.request({
        url: `${config.baseUrl}/email/batch`,
        body: payloads,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { classifyErrorCode, createPostmarkClient };
