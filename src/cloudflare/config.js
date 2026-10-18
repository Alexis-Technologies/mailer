// Ported from unemail v0.7.0 (src/drivers/cloudflare-email-rest.ts): the
// options of the driver of Cloudflare Email Service over its REST API.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const { checkCredential } = require('../internal/api.js');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

/**
 * Resolves the options of the Cloudflare transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createCloudflareConfig = (config = {}) => {
  const resolved = {
    accountId: checkCredential(config.accountId, 'accountId', 'CloudflareTransport'),
    apiToken: checkCredential(config.apiToken, 'apiToken', 'CloudflareTransport'),
    baseUrl: config.baseUrl ?? 'https://api.cloudflare.com/client/v4',
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

module.exports = { createCloudflareConfig };
