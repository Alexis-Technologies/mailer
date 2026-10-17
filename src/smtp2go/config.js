// Ported from unemail v0.7.0 (src/drivers/smtp2go.ts): the options of the
// SMTP2GO driver, the key and the region.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind

const { checkCredential } = require('../internal/api.js');
const { checkOptionalFunction } = require('../internal/options.js');
const {
  checkConcurrency,
  checkOptionalBoolean,
  checkRequestOptions,
  checkSecureUrl,
} = require('../internal/config.js');

// Without a region, the global host routes to the region nearest the
// resolver, which need not hold the account's data.
const HOSTS = {
  us: 'https://us-api.smtp2go.com',
  eu: 'https://eu-api.smtp2go.com',
  au: 'https://au-api.smtp2go.com',
};
const GLOBAL_HOST = 'https://api.smtp2go.com';

const hostOf = (region) => {
  if (region === undefined) return GLOBAL_HOST;
  if (!Object.hasOwn(HOSTS, region)) {
    throw new TypeError(`region must be 'us', 'eu' or 'au': ${String(region)}`);
  }
  return HOSTS[region];
};

/**
 * Resolves the options of the SMTP2GO transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createSmtp2goConfig = (config = {}) => {
  const host = hostOf(config.region);
  const resolved = {
    apiKey: checkCredential(config.apiKey, 'apiKey', 'Smtp2goTransport'),
    region: config.region,
    baseUrl: config.baseUrl ?? host,
    fastAccept: checkOptionalBoolean(config.fastAccept, 'fastAccept'),
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

module.exports = { createSmtp2goConfig };
