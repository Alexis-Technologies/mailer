// Ported from upyo v0.7.0 (packages/mailgun/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');
const { checkValidateSsl } = require('../internal/validate-ssl.js');

/**
 * Creates a resolved Mailgun configuration by applying default values to optional fields.
 *
 * This function takes a partial Mailgun configuration and returns a complete
 * configuration with all optional fields filled with sensible defaults.
 * It is used internally by the Mailgun transport.
 *
 * @param config - The Mailgun configuration with optional fields
 * @returns A resolved configuration with all defaults applied
 * @internal
 */
const createMailgunConfig = (config) => {
  checkValidateSsl(config.validateSsl);
  const region = config.region ?? 'us';
  const baseUrl = config.baseUrl ?? getDefaultBaseUrl(region);

  const resolved = {
    apiKey: config.apiKey,
    domain: config.domain,
    region,
    baseUrl,
    timeout: config.timeout ?? 30000,
    fetch: config.fetch,
    generateId: config.generateId,
    logger: config.logger,
    retries: config.retries ?? 3,
    concurrency: config.concurrency ?? 1,
    validateSsl: true,
    headers: config.headers ?? {},
    tracking: config.tracking ?? true,
    clickTracking: config.clickTracking ?? true,
    openTracking: config.openTracking ?? true,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkConcurrency(resolved.concurrency);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  return resolved;
};

/**
 * Gets the default base URL for a given Mailgun region.
 *
 * @param region - The Mailgun region
 * @returns The default base URL for the region
 */
const getDefaultBaseUrl = (region) => {
  switch (region) {
    case 'us':
      return 'https://api.mailgun.net/v3';
    case 'eu':
      return 'https://api.eu.mailgun.net/v3';
    default:
      throw new Error(`Unsupported region: ${region}`);
  }
};

module.exports = { createMailgunConfig };
