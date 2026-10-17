// Ported from unemail v0.7.0 (src/drivers/brevo.ts): the options of the Brevo
// driver.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const { checkCredential } = require('../internal/api.js');
const {
  checkConcurrency,
  checkOptionalBoolean,
  checkRequestOptions,
  checkSecureUrl,
} = require('../internal/config.js');

/**
 * Resolves the options of the Brevo transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createBrevoConfig = (config = {}) => {
  const resolved = {
    apiKey: checkCredential(config.apiKey, 'apiKey', 'BrevoTransport'),
    baseUrl: config.baseUrl ?? 'https://api.brevo.com',
    sandbox: checkOptionalBoolean(config.sandbox, 'sandbox') ?? false,
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

module.exports = { createBrevoConfig };
