// Not ported: the options of the Sinch transport: the service plan and its
// token, the region of the account, the sender and the callback of its
// delivery reports.

const { checkCredential } = require('../internal/api-steps.js');
const { checkWebhookUrl } = require('../internal/channel/webhook-url.js');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

// The regions of the SMS API, each a host the token is sent to
// (https://developers.sinch.com/docs/sms/api-reference/).
const REGIONS = new Set(['us', 'eu', 'au', 'br', 'ca']);
const DELIVERY_REPORTS = new Set([
  'none',
  'summary',
  'full',
  'per_recipient',
  'per_recipient_final',
]);

/**
 * Resolves the options of the Sinch transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createSinchConfig = (config = {}) => {
  const region = config.region ?? 'us';
  if (!REGIONS.has(region)) {
    throw new TypeError(
      `SinchTransport: region must be one of us, eu, au, br and ca: ${String(region)}`,
    );
  }
  const resolved = {
    servicePlanId: checkCredential(config.servicePlanId, 'servicePlanId', 'SinchTransport'),
    apiToken: checkCredential(config.apiToken, 'apiToken', 'SinchTransport'),
    region,
    baseUrl: config.baseUrl ?? `https://${region}.sms.api.sinch.com`,
    from: config.from,
    callbackUrl: config.callbackUrl,
    // Reports per recipient to a callback of the transport's, for the
    // events of each message; the account's setting otherwise.
    deliveryReport:
      config.deliveryReport ?? (config.callbackUrl === undefined ? undefined : 'per_recipient'),
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    concurrency: config.concurrency ?? 10,
    headers: config.headers ?? {},
    fetch: config.fetch,
    logger: config.logger,
    now: config.now ?? Date.now,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  if (resolved.callbackUrl !== undefined) checkWebhookUrl(resolved.callbackUrl, 'callbackUrl');
  if (resolved.deliveryReport !== undefined && !DELIVERY_REPORTS.has(resolved.deliveryReport)) {
    throw new TypeError(
      'SinchTransport: deliveryReport must be none, summary, full, per_recipient or ' +
        `per_recipient_final: ${String(resolved.deliveryReport)}`,
    );
  }
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createSinchConfig };
