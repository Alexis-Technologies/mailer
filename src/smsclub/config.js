// Not ported: the options of the SMS Club transport: the token of its JSON
// API and the alpha name of its SMS.

const { checkCredential } = require('../internal/api-steps.js');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

/**
 * Resolves the options of the SMS Club transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createSmsClubConfig = (config = {}) => {
  const resolved = {
    token: checkCredential(config.token, 'token', 'SmsClubTransport'),
    sender: config.sender,
    baseUrl: config.baseUrl ?? 'https://im.smsclub.mobi',
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    // SMS Club takes 9 requests a second of a user.
    concurrency: config.concurrency ?? 5,
    headers: config.headers ?? {},
    fetch: config.fetch,
    logger: config.logger,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createSmsClubConfig };
