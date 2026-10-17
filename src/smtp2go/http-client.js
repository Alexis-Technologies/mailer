// Ported from unemail v0.7.0 (src/drivers/smtp2go.ts): the requests of the
// SMTP2GO API, whose error is under `data` and a refused key a 400.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: through the shared client of the HTTP providers.

const { createApiClient } = require('../internal/api.js');

// The codes that say the key, not the message, is the problem.
const AUTH_ERROR_CODE = /PERMISSION|AUTH|API_KEY|UNAUTHORIZED|FORBIDDEN/i;

const messageOf = (json) => (typeof json?.data?.error === 'string' ? json.data.error : undefined);

const classify = (_status, json) => {
  const code = json?.data?.error_code;
  if (typeof code !== 'string' || code === '') return undefined;
  const name = code.startsWith('E_ApiResponseCodes.') ? code.slice(19) : code;
  const classified = AUTH_ERROR_CODE.test(name) ? { category: 'auth', retryable: false } : {};
  return { ...classified, code: `smtp2go.${name}` };
};

/**
 * The client of the SMTP2GO API.
 *
 * @internal
 */
const createSmtp2goClient = (config) => {
  const client = createApiClient(config, {
    id: 'smtp2go',
    label: 'SMTP2GO',
    authorize: (headers) => headers.set('X-Smtp2go-Api-Key', config.apiKey),
    messageOf,
    classify,
  });
  return {
    ...client,
    send: (payload, options) =>
      client.request({
        url: `${config.baseUrl}/v3/email/send`,
        body: payload,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { createSmtp2goClient };
