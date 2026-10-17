// Ported from unemail v0.7.0 (src/drivers/zeptomail.ts): the requests of the
// ZeptoMail API and the category of its error codes, `classifyZeptoError`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: through the shared client of the HTTP providers.

const { createApiClient } = require('../internal/api.js');

// The codes of `error.details`, which say more than the status: one 400
// covers a bad token, an unverified sender and a long subject.
const DETAIL_CODES = new Map([
  ['SERR_156', { category: 'auth', retryable: false }],
  ['SERR_157', { category: 'auth', retryable: false }],
  ['SM_111', { category: 'auth', retryable: false }],
  ['SM_128', { category: 'auth', retryable: false }],
  ['AE_101', { category: 'auth', retryable: false }],
  ['SM_133', { category: 'rate-limit', retryable: true }],
  ['SMI_115', { category: 'rate-limit', retryable: true }],
  // Credits spent come back only when bought.
  ['LE_101', { category: 'configuration', retryable: false }],
  ['LE_102', { category: 'configuration', retryable: false }],
]);
// The codes of a request that is malformed or too large.
const INVALID_CODES = new Set(['TM_3201', 'TM_3301', 'TM_8001']);
const INVALID = { category: 'validation', retryable: false };

// `{ error: { code, message, details: [{ code, message, target }] } }`.
const messageOf = (json) => {
  const error = json?.error;
  if (error == null || typeof error !== 'object') return undefined;
  const detail = Array.isArray(error.details) ? error.details[0] : undefined;
  let message = '';
  for (const part of [error.message, detail?.message, detail?.target]) {
    if (typeof part === 'string' && part !== '') message += message === '' ? part : `: ${part}`;
  }
  return message === '' ? undefined : message;
};

const classify = (_status, json) => {
  const error = json?.error;
  if (error == null || typeof error !== 'object') return undefined;
  const detail = Array.isArray(error.details) ? error.details[0]?.code : undefined;
  const classified =
    DETAIL_CODES.get(detail) ?? (INVALID_CODES.has(error.code) ? INVALID : undefined) ?? {};
  const code = detail ?? error.code;
  return typeof code === 'string' ? { ...classified, code: `zeptomail.${code}` } : classified;
};

/**
 * The client of the ZeptoMail API.
 *
 * @internal
 */
const createZeptoMailClient = (config) => {
  const client = createApiClient(config, {
    id: 'zeptomail',
    label: 'ZeptoMail',
    authorize: (headers) => headers.set('Authorization', config.token),
    messageOf,
    classify,
  });
  return {
    ...client,
    send: (payload, options) =>
      client.request({
        url: `${config.baseUrl}/v1.1/email`,
        body: payload,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { createZeptoMailClient };
