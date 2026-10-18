// Ported from unemail v0.7.0 (src/drivers/mailersend.ts): the options of the
// MailerSend driver.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const { checkCredential } = require('../internal/api.js');
const { checkOptionalFunction } = require('../internal/options.js');
const {
  checkConcurrency,
  checkOptionalBoolean,
  checkRequestOptions,
  checkSecureUrl,
} = require('../internal/config.js');

/**
 * Resolves the options of the MailerSend transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createMailerSendConfig = (config = {}) => {
  const resolved = {
    apiKey: checkCredential(config.apiKey, 'apiKey', 'MailerSendTransport'),
    baseUrl: config.baseUrl ?? 'https://api.mailersend.com',
    openTracking: checkOptionalBoolean(config.openTracking, 'openTracking'),
    clickTracking: checkOptionalBoolean(config.clickTracking, 'clickTracking'),
    precedenceBulk: checkOptionalBoolean(config.precedenceBulk, 'precedenceBulk'),
    concurrency: config.concurrency ?? 5,
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    headers: config.headers ?? {},
    fetch: config.fetch,
    generateId: config.generateId,
    logger: config.logger,
    now: checkOptionalFunction(config.now, 'now') ?? Date.now,
  };
  checkConcurrency(resolved.concurrency);
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  return resolved;
};

module.exports = { createMailerSendConfig };
