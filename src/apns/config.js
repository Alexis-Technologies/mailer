// Not ported: the options of the APNs transport: the team, the key and its
// id of token authentication, the topic of the app, and the environment,
// which is named, never read from NODE_ENV (AP1).

const { randomUUID } = require('node:crypto');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');
const { privateKeyOf } = require('../internal/jwt.js');

const HOSTS = new Map([
  ['production', 'https://api.push.apple.com'],
  ['sandbox', 'https://api.sandbox.push.apple.com'],
]);
// A team id and a key id of Apple: ten characters of A-Z and 0-9.
const APPLE_ID = /^[A-Z0-9]{10}$/;

const checkAppleId = (value, name) => {
  if (typeof value !== 'string' || !APPLE_ID.test(value)) {
    throw new TypeError(`ApnsTransport: ${name} must be the ten characters Apple gives it.`);
  }
  return value;
};

/**
 * Resolves the options of the APNs transport.
 *
 * @param config The options.
 * @returns The options with their defaults, the key read.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createApnsConfig = (config = {}) => {
  const host = HOSTS.get(config.environment);
  if (host === undefined) {
    throw new TypeError(
      'ApnsTransport: environment must be production or sandbox, as the token of a ' +
        'device is of one of them.',
    );
  }
  if (typeof config.topic !== 'string' || config.topic === '') {
    throw new TypeError('ApnsTransport needs topic, the bundle id of the app.');
  }
  const resolved = {
    teamId: checkAppleId(config.teamId, 'teamId'),
    keyId: checkAppleId(config.keyId, 'keyId'),
    privateKey: privateKeyOf(config.privateKey, 'ES256', 'ApnsTransport: privateKey'),
    topic: config.topic,
    environment: config.environment,
    baseUrl: config.baseUrl ?? host,
    tls: config.tls,
    pingIntervalMs: config.pingIntervalMs,
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    concurrency: config.concurrency ?? 10,
    headers: config.headers ?? {},
    fetch: config.fetch,
    logger: config.logger,
    generateId: config.generateId ?? randomUUID,
    now: config.now ?? Date.now,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createApnsConfig };
