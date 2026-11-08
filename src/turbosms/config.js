// Not ported: the options of the TurboSMS transport: the token of the HTTP
// API and the senders of its SMS and its Viber messages.

const { checkCredential } = require('../internal/api-steps.js');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

/**
 * Resolves the options of the TurboSMS transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createTurboSmsConfig = (config = {}) => {
  const resolved = {
    token: checkCredential(config.token, 'token', 'TurboSmsTransport'),
    sender: config.sender,
    viberSender: config.viberSender ?? config.sender,
    baseUrl: config.baseUrl ?? 'https://api.turbosms.ua',
    timeout: config.timeout ?? 60000,
    retries: config.retries ?? 3,
    concurrency: config.concurrency ?? 5,
    headers: config.headers ?? {},
    fetch: config.fetch,
    logger: config.logger,
    generateId: config.generateId,
    now: config.now ?? Date.now,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createTurboSmsConfig };
