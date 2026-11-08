// Not ported: the options of the Vonage transport: the key and secret of
// the account, the sender, and the URL its delivery receipts go to.

const { checkCredential } = require('../internal/api-steps.js');
const { checkWebhookUrl } = require('../internal/channel/webhook-url.js');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

const MAX_CALLBACK = 100;

/**
 * Resolves the options of the Vonage transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createVonageConfig = (config = {}) => {
  const resolved = {
    apiKey: checkCredential(config.apiKey, 'apiKey', 'VonageTransport'),
    apiSecret: checkCredential(config.apiSecret, 'apiSecret', 'VonageTransport'),
    from: config.from,
    callback: config.callback,
    baseUrl: config.baseUrl ?? 'https://rest.nexmo.com',
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    concurrency: config.concurrency ?? 10,
    headers: config.headers ?? {},
    fetch: config.fetch,
    logger: config.logger,
    now: config.now ?? Date.now,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  if (resolved.callback !== undefined) {
    checkWebhookUrl(resolved.callback, 'callback');
    // The longest callback the SMS API takes.
    if (resolved.callback.length > MAX_CALLBACK) {
      throw new TypeError(`VonageTransport: callback is more than ${MAX_CALLBACK} characters.`);
    }
  }
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createVonageConfig };
