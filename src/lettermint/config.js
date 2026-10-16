// Ported from upyo v0.7.0 (packages/lettermint/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

/**
 * Creates a resolved Lettermint configuration by applying default values.
 *
 * @param config The Lettermint configuration with optional fields.
 * @returns A resolved configuration with all defaults applied.
 */
const createLettermintConfig = (config) => {
  const resolved = {
    apiToken: config.apiToken,
    baseUrl: normalizeBaseUrl(config.baseUrl ?? 'https://api.lettermint.co'),
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    headers: config.headers ?? {},
    route: config.route,
    tag: config.tag,
    metadata: config.metadata == null ? undefined : { ...config.metadata },
    settings: config.settings == null ? undefined : { ...config.settings },
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  return resolved;
};

const normalizeBaseUrl = (baseUrl) => {
  return baseUrl.replace(/\/+$/, '');
};

module.exports = { createLettermintConfig };
