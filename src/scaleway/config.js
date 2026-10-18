// Ported from unemail v0.7.0 (src/drivers/scaleway.ts): the options of the
// Scaleway Transactional Email driver.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: the region must look like one (`fr-par`), as it is a
// segment of the path.

const { checkCredential } = require('../internal/api.js');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

const REGION = /^[a-z]{2}-[a-z]{3}$/;

/**
 * Resolves the options of the Scaleway transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createScalewayConfig = (config = {}) => {
  const region = config.region ?? 'fr-par';
  if (typeof region !== 'string' || !REGION.test(region)) {
    throw new TypeError(`region must be a Scaleway region such as fr-par: ${String(region)}`);
  }
  const resolved = {
    secretKey: checkCredential(config.secretKey, 'secretKey', 'ScalewayTransport'),
    projectId: checkCredential(config.projectId, 'projectId', 'ScalewayTransport'),
    region,
    baseUrl: config.baseUrl ?? 'https://api.scaleway.com',
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

module.exports = { createScalewayConfig };
