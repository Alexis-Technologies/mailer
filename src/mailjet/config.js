// Ported from unemail v0.7.0 (src/drivers/mailjet.ts): the options of the
// Mailjet driver, the key pair and the sandbox.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const { checkCredential } = require('../internal/api.js');
const {
  checkOptionalBoolean,
  checkRequestOptions,
  checkSecureUrl,
} = require('../internal/config.js');

/**
 * Resolves the options of the Mailjet transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createMailjetConfig = (config = {}) => {
  const resolved = {
    apiKey: checkCredential(config.apiKey, 'apiKey', 'MailjetTransport'),
    apiSecret: checkCredential(config.apiSecret, 'apiSecret', 'MailjetTransport'),
    baseUrl: config.baseUrl ?? 'https://api.mailjet.com',
    sandbox: checkOptionalBoolean(config.sandbox, 'sandbox') ?? false,
    openTracking: checkOptionalBoolean(config.openTracking, 'openTracking'),
    clickTracking: checkOptionalBoolean(config.clickTracking, 'clickTracking'),
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    headers: config.headers ?? {},
    fetch: config.fetch,
    generateId: config.generateId,
    logger: config.logger,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  return resolved;
};

module.exports = { createMailjetConfig };
