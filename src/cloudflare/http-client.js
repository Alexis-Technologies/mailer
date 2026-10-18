// Ported from unemail v0.7.0 (src/drivers/cloudflare-email-rest.ts): the
// requests of the Email Service API of Cloudflare.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: through the shared client of the HTTP providers, the
// status choosing the category and the numeric code of the error kept.

const { createApiClient } = require('../internal/api.js');

/**
 * The code of the first error of an answer, `{ errors: [{ code, message }] }`.
 *
 * @internal
 */
const errorCodeOf = (json) => {
  const code = Array.isArray(json?.errors) ? json.errors[0]?.code : undefined;
  return typeof code === 'number' || typeof code === 'string' ? `cloudflare.${code}` : undefined;
};

/**
 * The client of the Email Service API of Cloudflare.
 *
 * @internal
 */
const createCloudflareClient = (config) => {
  const client = createApiClient(config, {
    id: 'cloudflare',
    label: 'Cloudflare',
    authorize: (headers) => headers.set('Authorization', `Bearer ${config.apiToken}`),
    classify: (_status, json) => {
      const code = errorCodeOf(json);
      return code === undefined ? undefined : { code };
    },
  });
  const account = `${config.baseUrl}/accounts/${encodeURIComponent(config.accountId)}`;
  const post = (path, payload, options) =>
    client.request({
      url: `${account}${path}`,
      body: payload,
      signal: options?.signal,
      onRetry: options?.onRetry,
    });
  return {
    ...client,
    account,
    send: (payload, options) => post('/email/sending/send', payload, options),
    sendRaw: (payload, options) => post('/email/sending/send_raw', payload, options),
  };
};

module.exports = { createCloudflareClient, errorCodeOf };
