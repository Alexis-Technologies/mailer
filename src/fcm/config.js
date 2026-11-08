// Not ported: the options of the FCM transport: the service account of the
// Firebase project and the project it sends for.

const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

// A project id of Google: lowercase letters, digits and hyphens.
const PROJECT_ID = /^[a-z][a-z0-9-]{4,62}$/;

/**
 * Resolves the options of the FCM transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createFcmConfig = (config = {}) => {
  const account = config.serviceAccount;
  if (account === null || typeof account !== 'object') {
    throw new TypeError('FcmTransport needs serviceAccount, the parsed JSON of a service account.');
  }
  const projectId = config.projectId ?? account.project_id;
  if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) {
    throw new TypeError('FcmTransport needs projectId, the id of its Firebase project.');
  }
  const resolved = {
    serviceAccount: account,
    projectId,
    baseUrl: config.baseUrl ?? 'https://fcm.googleapis.com',
    tokenUrl: config.tokenUrl,
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    concurrency: config.concurrency ?? 10,
    headers: config.headers ?? {},
    fetch: config.fetch,
    logger: config.logger,
    now: config.now,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createFcmConfig };
