// Not ported: the options of the AlphaSMS transport: the key of the JSON
// API, the signatures of its SMS and its Viber messages, and the URL of the
// webhook of their statuses.

const { randomInt } = require('node:crypto');
const { checkCredential } = require('../internal/api-steps.js');
const { checkWebhookUrl } = require('../internal/channel/webhook-url.js');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

// The id of a message in the system of the client is a number.
const MAX_ID = 2 ** 48;

/**
 * Resolves the options of the AlphaSMS transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createAlphaSmsConfig = (config = {}) => {
  const resolved = {
    apiKey: checkCredential(config.apiKey, 'apiKey', 'AlphaSmsTransport'),
    sender: config.sender,
    viberSender: config.viberSender ?? config.sender,
    hook: config.hook,
    baseUrl: config.baseUrl ?? 'https://api.alphasms.ua',
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    concurrency: config.concurrency ?? 5,
    headers: config.headers ?? {},
    fetch: config.fetch,
    logger: config.logger,
    generateId: config.generateId ?? (() => randomInt(1, MAX_ID)),
    now: config.now ?? Date.now,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  if (resolved.hook !== undefined) checkWebhookUrl(resolved.hook, 'hook');
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createAlphaSmsConfig };
