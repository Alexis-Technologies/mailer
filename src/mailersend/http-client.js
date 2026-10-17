// Ported from unemail v0.7.0 (src/drivers/mailersend.ts): the requests of the
// MailerSend API, and the reasons of a validation error.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: through the shared client of the HTTP providers.

const { createApiClient } = require('../internal/api.js');

// MailerSend gives `{ message, errors: { field: [reason] } }`, the message the
// same sentence for any of them: the reasons of the fields say what failed.
const messageOf = (json) => {
  const errors = json?.errors;
  if (errors == null || typeof errors !== 'object') return json?.message;
  let text = '';
  for (const field in errors) {
    if (!Object.hasOwn(errors, field)) continue;
    const reasons = Array.isArray(errors[field]) ? errors[field].join(', ') : String(errors[field]);
    text += text === '' ? `${field}: ${reasons}` : `; ${field}: ${reasons}`;
  }
  return text === '' ? json?.message : text;
};

/**
 * The client of the MailerSend API.
 *
 * @internal
 */
const createMailerSendClient = (config) => {
  const client = createApiClient(config, {
    id: 'mailersend',
    label: 'MailerSend',
    authorize: (headers) => headers.set('Authorization', `Bearer ${config.apiKey}`),
    messageOf,
  });
  return {
    ...client,
    send: (payload, options) =>
      client.request({
        url: `${config.baseUrl}/v1/email`,
        body: payload,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { createMailerSendClient };
