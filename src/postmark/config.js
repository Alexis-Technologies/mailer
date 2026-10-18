// Ported from unemail v0.7.0 (src/drivers/postmark.ts): the options of the
// Postmark driver, the server token and the message stream.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const { checkCredential } = require('../internal/api.js');
const {
  checkOptionalBoolean,
  checkOptionalString,
  checkRequestOptions,
  checkSecureUrl,
} = require('../internal/config.js');

/**
 * Resolves the options of the Postmark transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createPostmarkConfig = (config = {}) => {
  const resolved = {
    serverToken: checkCredential(config.serverToken, 'serverToken', 'PostmarkTransport'),
    baseUrl: config.baseUrl ?? 'https://api.postmarkapp.com',
    messageStream: checkOptionalString(config.messageStream, 'messageStream'),
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

module.exports = { createPostmarkConfig };
