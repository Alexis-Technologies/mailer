// Ported from upyo v0.7.0 (packages/plunk/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

/**
 * Creates a resolved Plunk configuration by applying default values to optional fields.
 *
 * This function takes a partial Plunk configuration and returns a complete
 * configuration with all optional fields filled with sensible defaults.
 * It is used internally by the Plunk transport.
 *
 * @param config - The Plunk configuration with optional fields
 * @returns A resolved configuration with all defaults applied
 * @internal
 */
const createPlunkConfig = (config) => {
  const resolved = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? 'https://next-api.useplunk.com',
    timeout: config.timeout ?? 30000,
    fetch: config.fetch,
    generateId: config.generateId,
    retries: config.retries ?? 3,
    validateSsl: config.validateSsl ?? true,
    headers: config.headers ?? {},
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  return resolved;
};

module.exports = { createPlunkConfig };
