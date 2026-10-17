// Ported from unemail v0.7.0 (src/drivers/mailjet.ts): the requests of the
// Mailjet Send API v3.1.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: through the shared client of the HTTP providers, with
// the key pair encoded as UTF-8 for Basic authentication.

const { Buffer } = require('node:buffer');
const { createApiClient } = require('../internal/api.js');

// The message of an answer: the errors of its first failed message.
const messageOf = (json) => {
  const messages = Array.isArray(json?.Messages) ? json.Messages : [];
  for (const entry of messages) {
    if (entry?.Status === 'success') continue;
    const error = Array.isArray(entry?.Errors) ? entry.Errors[0] : undefined;
    if (error?.ErrorMessage) return error.ErrorMessage;
  }
  return json?.ErrorMessage;
};

/**
 * The client of the Mailjet API.
 *
 * @internal
 */
const createMailjetClient = (config) => {
  const authorization = `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`, 'utf8').toString('base64')}`;
  const client = createApiClient(config, {
    id: 'mailjet',
    label: 'Mailjet',
    authorize: (headers) => headers.set('Authorization', authorization),
    messageOf,
  });
  return {
    ...client,
    send: (messages, options) =>
      client.request({
        url: `${config.baseUrl}/v3.1/send`,
        body: config.sandbox ? { Messages: messages, SandboxMode: true } : { Messages: messages },
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { createMailjetClient };
