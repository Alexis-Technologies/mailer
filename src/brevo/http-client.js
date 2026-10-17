// Ported from unemail v0.7.0 (src/drivers/brevo.ts): the requests of the Brevo
// API and the category of its error codes.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: through the shared client of the HTTP providers, a
// request with an idempotency key retried after a failure that leaves its
// delivery unknown.

const { createApiClient } = require('../internal/api.js');

// What a `code` of Brevo says, where it says more than its status.
const ERROR_CODES = new Map([
  ['unauthorized', { category: 'auth', retryable: false }],
  ['permission_denied', { category: 'auth', retryable: false }],
  ['account_under_validation', { category: 'configuration', retryable: false }],
  ['not_enough_credits', { category: 'configuration', retryable: false }],
]);

/**
 * The client of the Brevo API.
 *
 * @internal
 */
const createBrevoClient = (config) => {
  const client = createApiClient(config, {
    id: 'brevo',
    label: 'Brevo',
    authorize: (headers) => headers.set('api-key', config.apiKey),
    classify: (status, json) => {
      const code = typeof json?.code === 'string' ? json.code : undefined;
      if (code === undefined) return undefined;
      return { ...ERROR_CODES.get(code), code: `brevo.${code}` };
    },
  });
  return {
    ...client,
    send: (payload, options) =>
      client.request({
        url: `${config.baseUrl}/v3/smtp/email`,
        body: payload,
        // The key is in the headers of the message: Brevo answers its repeat
        // with duplicate_parameter rather than sending again.
        hasIdempotencyKey: true,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { createBrevoClient };
