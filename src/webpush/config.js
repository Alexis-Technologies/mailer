// Not ported: the options of the Web Push transport: the VAPID keys of the
// application, the time a push lives without an expiry of its own, and the
// check of the endpoints it sends to.

const { checkConcurrency, checkRequestOptions } = require('../internal/config.js');
const { checkOptionalFunction } = require('../internal/options.js');
const { checkVapid } = require('./vapid.js');

// Four weeks, the longest most push services keep a message.
const DEFAULT_TTL_SECONDS = 28 * 24 * 60 * 60;

/**
 * Resolves the options of the Web Push transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createWebPushConfig = (config = {}) => {
  const resolved = {
    vapid: checkVapid(config.vapid),
    ttl: config.ttl ?? DEFAULT_TTL_SECONDS,
    allowEndpoint: checkOptionalFunction(config.allowEndpoint, 'allowEndpoint'),
    lookup: checkOptionalFunction(config.lookup, 'lookup'),
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    concurrency: config.concurrency ?? 10,
    headers: config.headers ?? {},
    fetch: config.fetch,
    generateId: config.generateId,
    logger: config.logger,
    now: checkOptionalFunction(config.now, 'now') ?? Date.now,
  };
  if (!Number.isInteger(resolved.ttl) || resolved.ttl < 0) {
    throw new TypeError('ttl of WebPushTransport is a whole number of seconds.');
  }
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createWebPushConfig };
