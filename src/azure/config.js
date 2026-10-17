// Ported from unemail v0.7.0 (src/drivers/azure-communication.ts): the options
// of the Azure Communication Services driver, `resolveCredentials`.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: the connection string is never read from
// `process.env`, and the endpoint must be HTTPS (or HTTP to this machine),
// where unemail took any `http:` one.

const {
  checkConcurrency,
  checkOptionalBoolean,
  checkRequestOptions,
  checkSecureUrl,
} = require('../internal/config.js');
const { isAccessKey, parseConnectionString } = require('./sign.js');

const API_VERSION = /^\d{4}-\d{2}-\d{2}(-preview)?$/;

const credentialsOf = (config) => {
  if (config.connectionString !== undefined) {
    const parsed =
      typeof config.connectionString === 'string'
        ? parseConnectionString(config.connectionString)
        : undefined;
    if (parsed === undefined) {
      throw new TypeError(
        'connectionString must be `endpoint=https://…;accesskey=…`, as the Keys of the ' +
          'resource show it.',
      );
    }
    return parsed;
  }
  if (typeof config.endpoint !== 'string' || config.endpoint === '') {
    throw new TypeError('AzureTransport needs connectionString, or endpoint and accessKey.');
  }
  return { endpoint: config.endpoint, accessKey: config.accessKey };
};

/**
 * Resolves the options of the Azure transport.
 *
 * @param config The options.
 * @returns The options with their defaults, the credentials split.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createAzureConfig = (config = {}) => {
  const credentials = credentialsOf(config);
  if (!isAccessKey(credentials.accessKey)) {
    throw new TypeError('accessKey must be the base64 key of the resource, as its Keys show it.');
  }
  checkSecureUrl(credentials.endpoint, 'endpoint');
  const apiVersion = config.apiVersion ?? '2025-09-01';
  if (typeof apiVersion !== 'string' || !API_VERSION.test(apiVersion)) {
    throw new TypeError(`apiVersion must be a date such as 2025-09-01: ${String(apiVersion)}`);
  }
  const resolved = {
    endpoint: credentials.endpoint.replace(/\/+$/, ''),
    accessKey: credentials.accessKey,
    apiVersion,
    userEngagementTrackingDisabled: checkOptionalBoolean(
      config.userEngagementTrackingDisabled,
      'userEngagementTrackingDisabled',
    ),
    concurrency: config.concurrency ?? 5,
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    headers: config.headers ?? {},
    fetch: config.fetch,
    generateId: config.generateId,
    logger: config.logger,
    now: config.now ?? Date.now,
  };
  checkConcurrency(resolved.concurrency);
  checkRequestOptions(resolved.timeout, resolved.retries);
  return resolved;
};

module.exports = { createAzureConfig };
