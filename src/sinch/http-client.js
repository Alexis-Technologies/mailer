// Ported from @thinwrap/notifications v1.2.0 (src/providers/sinch/sinch.connector.ts):
// the request of the batches of the SMS API of Sinch with the Bearer token of
// a service plan, on the host of its region, and the categories of its
// errors by their status and code.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: through the shared client of the HTTP providers, so a
// redirect is not followed, the body is bounded, and a send is never retried
// after a lost answer; a 403 or a region not provisioned is `configuration`,
// where thinwrap made it an authentication failure.

const { createApiClient } = require('../internal/api-client.js');

const STATUSES = new Map([
  [400, 'validation'],
  [401, 'auth'],
  [403, 'configuration'],
  [404, 'configuration'],
  [429, 'rate-limit'],
]);
const CODES = new Map([
  ['invalid_recipient', 'invalid-recipient'],
  ['invalid_destination', 'invalid-recipient'],
  ['unprovisioned_region', 'configuration'],
]);
const RETRYABLE = new Set(['rate-limit', 'server-error']);

/**
 * The category of an error of Sinch: by its code, then its status.
 *
 * @internal
 */
const classifySinch = (status, json) => {
  const code = typeof json?.code === 'string' ? json.code : undefined;
  const category =
    CODES.get(code) ?? STATUSES.get(status) ?? (status >= 500 ? 'server-error' : undefined);
  return {
    category,
    retryable: category === undefined ? undefined : RETRYABLE.has(category),
    code: `sinch.${code ?? `http_${status}`}`,
  };
};

/**
 * The client of the batches of a service plan.
 *
 * @internal
 */
const createSinchClient = (config) => {
  const client = createApiClient(config, {
    id: 'sinch',
    label: 'Sinch',
    authorize: (headers) => headers.set('Authorization', `Bearer ${config.apiToken}`),
    messageOf: (json) => (typeof json?.text === 'string' ? json.text : undefined),
    classify: classifySinch,
  });
  const batchesUrl = `${config.baseUrl}/xms/v1/${encodeURIComponent(config.servicePlanId)}/batches`;
  return {
    ...client,
    // A page of one batch: a read that sends nothing.
    listUrl: `${batchesUrl}?page_size=1`,
    send: (body, options) =>
      client.request({
        url: batchesUrl,
        body,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { classifySinch, createSinchClient };
