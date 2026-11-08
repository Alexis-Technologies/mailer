// Not ported: the options of the RBM transport: the service account of the
// agent, its id, and the region of the API.

const { randomUUID } = require('node:crypto');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

// The hosts of the regions of the API.
const HOSTS = new Map([
  ['global', 'https://rcsbusinessmessaging.googleapis.com'],
  ['europe', 'https://europe-rcsbusinessmessaging.googleapis.com'],
  ['asia', 'https://asia-rcsbusinessmessaging.googleapis.com'],
]);

/**
 * Resolves the options of the RBM transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createRbmConfig = (config = {}) => {
  const account = config.serviceAccount;
  if (account === null || typeof account !== 'object') {
    throw new TypeError('RbmTransport needs serviceAccount, the parsed JSON of a service account.');
  }
  if (typeof config.agentId !== 'string' || config.agentId === '') {
    throw new TypeError('RbmTransport needs agentId, the id of the agent.');
  }
  const region = config.region ?? 'global';
  const host = HOSTS.get(region);
  if (host === undefined) {
    throw new TypeError(`RbmTransport: region must be global, europe or asia: ${String(region)}`);
  }
  const resolved = {
    serviceAccount: account,
    agentId: config.agentId,
    region,
    baseUrl: config.baseUrl ?? host,
    tokenUrl: config.tokenUrl,
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    concurrency: config.concurrency ?? 10,
    headers: config.headers ?? {},
    fetch: config.fetch,
    logger: config.logger,
    generateId: config.generateId ?? randomUUID,
    now: config.now,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createRbmConfig };
