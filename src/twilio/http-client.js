// Ported from @thinwrap/notifications v1.2.0 (src/providers/twilio/twilio.connector.ts):
// the request of the Messages API, a form with Basic credentials, and the
// categories of its errors by status and code.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: through the shared client of the HTTP providers, so a
// redirect is not followed, the body is bounded, the caller's signal and the
// timeout end a request rather than none (T11), and a request is never sent
// again after a timeout or a lost answer, as visulima sent it (V7,
// `providers/utils/http.ts`); the codes are those of `codes.js`, where
// thinwrap made a STOP an invalid recipient (T6).

const { Buffer } = require('node:buffer');
const { createApiClient } = require('../internal/api-client.js');
const { categoryOfCode } = require('./codes.js');

const RETRYABLE = new Set(['rate-limit', 'service-unavailable', 'unreachable']);
const STATUSES = new Map([
  [400, 'validation'],
  [401, 'auth'],
  [403, 'configuration'],
  [404, 'configuration'],
  [429, 'rate-limit'],
]);

/**
 * The category of an error of Twilio: by its code, then its status.
 *
 * @internal
 */
const classifyTwilio = (status, json) => {
  const code = typeof json?.code === 'number' ? json.code : undefined;
  const category =
    categoryOfCode(code) ?? STATUSES.get(status) ?? (status >= 500 ? 'server-error' : undefined);
  if (category === undefined) return undefined;
  return {
    category,
    retryable: RETRYABLE.has(category) || status >= 500,
    code: `twilio.${code ?? `http_${status}`}`,
  };
};

/**
 * The client of the Messages API.
 *
 * @internal
 */
const createTwilioClient = (config) => {
  const authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
  const client = createApiClient(config, {
    id: 'twilio',
    label: 'Twilio',
    authorize: (headers) => headers.set('Authorization', authorization),
    classify: classifyTwilio,
  });
  const accountUrl = `${config.baseUrl}/2010-04-01/Accounts/${config.accountSid}`;
  return {
    ...client,
    accountUrl,
    create: (form, options) =>
      client.request({
        url: `${accountUrl}/Messages.json`,
        body: form,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { classifyTwilio, createTwilioClient };
