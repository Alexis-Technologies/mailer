// Ported from sently v1.2.2 (src/transports/sparkpost.ts): the options of the
// SparkPost transport, the key and the region.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors

const { checkCredential } = require('../internal/api.js');
const {
  checkConcurrency,
  checkOptionalBoolean,
  checkOptionalString,
  checkRequestOptions,
  checkSecureUrl,
} = require('../internal/config.js');

const BASE_URLS = { us: 'https://api.sparkpost.com', eu: 'https://api.eu.sparkpost.com' };

/**
 * Resolves the options of the SparkPost transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createSparkPostConfig = (config = {}) => {
  const region = config.region ?? 'us';
  if (!Object.hasOwn(BASE_URLS, region)) {
    throw new TypeError(`region must be 'us' or 'eu': ${String(region)}`);
  }
  const resolved = {
    apiKey: checkCredential(config.apiKey, 'apiKey', 'SparkPostTransport'),
    region,
    baseUrl: config.baseUrl ?? BASE_URLS[region],
    campaignId: checkOptionalString(config.campaignId, 'campaignId'),
    transactional: checkOptionalBoolean(config.transactional, 'transactional'),
    openTracking: checkOptionalBoolean(config.openTracking, 'openTracking'),
    clickTracking: checkOptionalBoolean(config.clickTracking, 'clickTracking'),
    concurrency: config.concurrency ?? 5,
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    headers: config.headers ?? {},
    fetch: config.fetch,
    generateId: config.generateId,
    logger: config.logger,
  };
  checkConcurrency(resolved.concurrency);
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  return resolved;
};

module.exports = { createSparkPostConfig };
