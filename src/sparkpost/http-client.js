// Ported from sently v1.2.2 (src/transports/sparkpost.ts): the requests of the
// SparkPost Transmissions API.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: through the shared client of the HTTP providers, which
// reads the status before the body, as sently did not.

const { createApiClient } = require('../internal/api.js');

// The codes of SparkPost whose category the status does not tell: 1902, a
// recipient on the suppression list; 7001, a sending domain not verified.
const CODES = new Map([
  ['1902', { category: 'rejected', retryable: false }],
  ['7001', { category: 'configuration', retryable: false }],
]);
// 420: the sending limit of the account is spent.
const STATUSES = new Map([[420, { category: 'rate-limit', retryable: true }]]);

// SparkPost gives `{ errors: [{ message, description, code }] }`.
const messageOf = (json) => {
  const error = Array.isArray(json?.errors) ? json.errors[0] : undefined;
  if (error == null) return json?.message;
  return error.description ? `${error.message}: ${error.description}` : error.message;
};

/**
 * The client of the SparkPost API.
 *
 * @internal
 */
const createSparkPostClient = (config) => {
  const client = createApiClient(config, {
    id: 'sparkpost',
    label: 'SparkPost',
    authorize: (headers) => headers.set('Authorization', config.apiKey),
    messageOf,
    classify: (status, json) => {
      const code = Array.isArray(json?.errors) ? json.errors[0]?.code : undefined;
      const classified = CODES.get(String(code)) ?? STATUSES.get(status) ?? {};
      return code == null ? classified : { ...classified, code: `sparkpost.${code}` };
    },
  });
  return {
    ...client,
    send: (transmission, options) =>
      client.request({
        url: `${config.baseUrl}/api/v1/transmissions`,
        body: transmission,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { createSparkPostClient };
