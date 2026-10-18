// Ported from unemail v0.7.0 (src/drivers/zeptomail.ts): the options of the
// ZeptoMail driver.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const { checkCredential } = require('../internal/api.js');
const {
  checkConcurrency,
  checkOptionalBoolean,
  checkOptionalString,
  checkRequestOptions,
  checkSecureUrl,
} = require('../internal/config.js');

const AUTH_PREFIX = 'zoho-enczapikey ';

/**
 * Resolves the options of the ZeptoMail transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createZeptoMailConfig = (config = {}) => {
  const token = checkCredential(config.token, 'token', 'ZeptoMailTransport');
  const resolved = {
    // The token is shown with its scheme, which may be pasted with it.
    token: token.toLowerCase().startsWith(AUTH_PREFIX) ? token : `Zoho-enczapikey ${token}`,
    baseUrl: config.baseUrl ?? 'https://api.zeptomail.com',
    bounceAddress: checkOptionalString(config.bounceAddress, 'bounceAddress'),
    clientReference: checkOptionalString(config.clientReference, 'clientReference'),
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

module.exports = { createZeptoMailConfig };
