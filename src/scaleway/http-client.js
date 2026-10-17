// Ported from unemail v0.7.0 (src/drivers/scaleway.ts): the requests of the
// Transactional Email API of Scaleway, and what its error types say.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: through the shared client of the HTTP providers; a
// spent quota is a `configuration` failure rather than a rate limit.

const { createApiClient } = require('../internal/api.js');

// `{ type, message, details: [{ argument_name, reason }] }`.
const messageOf = (json) => {
  if (json == null || typeof json !== 'object') return undefined;
  let message = typeof json.message === 'string' ? json.message : '';
  if (json.type === 'invalid_arguments' && Array.isArray(json.details)) {
    let fields = '';
    for (const detail of json.details) {
      let field = typeof detail?.argument_name === 'string' ? detail.argument_name : '';
      if (typeof detail?.reason === 'string') {
        field += field === '' ? detail.reason : ` ${detail.reason}`;
      }
      if (field !== '') fields += fields === '' ? field : `; ${field}`;
    }
    if (fields !== '') message = `${message === '' ? 'invalid arguments' : message}: ${fields}`;
  }
  return message === '' ? undefined : message;
};

const classify = (_status, json) => {
  const type = json?.type;
  if (typeof type !== 'string' || type === '') return undefined;
  // A 403 for the monthly quota, which no retry clears.
  const classified =
    type === 'quotas_exceeded' ? { category: 'configuration', retryable: false } : {};
  return { ...classified, code: `scaleway.${type}` };
};

/**
 * The client of the Transactional Email API of Scaleway.
 *
 * @internal
 */
const createScalewayClient = (config) => {
  const client = createApiClient(config, {
    id: 'scaleway',
    label: 'Scaleway',
    authorize: (headers) => headers.set('X-Auth-Token', config.secretKey),
    messageOf,
    classify,
  });
  const base =
    `${config.baseUrl}/transactional-email/v1alpha1/regions/` + encodeURIComponent(config.region);
  return {
    ...client,
    base,
    send: (payload, options) =>
      client.request({
        url: `${base}/emails`,
        body: payload,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { createScalewayClient };
