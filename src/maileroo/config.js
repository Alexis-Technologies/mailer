// Ported from upyo v0.7.0 (packages/maileroo/src/config.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

/**
 * Creates a resolved Maileroo configuration by applying default values.
 *
 * @param config The Maileroo configuration with optional fields.
 * @returns A resolved configuration with all defaults applied.
 */
const createMailerooConfig = (config) => {
  const resolved = {
    apiKey: config.apiKey,
    baseUrl: normalizeBaseUrl(config.baseUrl ?? 'https://smtp.maileroo.com/api/v2'),
    timeout: config.timeout ?? 30000,
    fetch: config.fetch,
    generateId: config.generateId,
    logger: config.logger,
    retries: config.retries ?? 3,
    concurrency: config.concurrency ?? 1,
    headers: config.headers == null ? {} : { ...config.headers },
    tracking: config.tracking,
    tags: config.tags == null ? undefined : { ...config.tags },
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkConcurrency(resolved.concurrency);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  return resolved;
};

const normalizeBaseUrl = (baseUrl) => {
  return baseUrl.replace(/\/+$/, '');
};

module.exports = { createMailerooConfig };
