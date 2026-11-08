// Not ported: the options of the Google Chat transport: the URL of a webhook
// of a space, the service account of a Chat app, or both.

const { checkCredential } = require('../internal/api-steps.js');
const { checkWebhookUrl } = require('../internal/channel/webhook-url.js');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

/**
 * Resolves the options of the Google Chat transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid, or neither credential given.
 * @internal
 */
const createGoogleChatConfig = (config = {}) => {
  const webhookUrl =
    config.webhookUrl === undefined
      ? undefined
      : checkCredential(config.webhookUrl, 'webhookUrl', 'GoogleChatTransport');
  const account = config.serviceAccount;
  if (account !== undefined && (account === null || typeof account !== 'object')) {
    throw new TypeError('serviceAccount of GoogleChatTransport is the parsed JSON of an account.');
  }
  if (webhookUrl === undefined && account === undefined) {
    throw new TypeError('GoogleChatTransport needs webhookUrl, serviceAccount or both.');
  }
  const resolved = {
    webhookUrl,
    serviceAccount: account,
    baseUrl: config.baseUrl ?? 'https://chat.googleapis.com',
    tokenUrl: config.tokenUrl,
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    concurrency: config.concurrency ?? 5,
    headers: config.headers ?? {},
    fetch: config.fetch,
    logger: config.logger,
    generateId: config.generateId,
    now: config.now,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  if (webhookUrl !== undefined) checkWebhookUrl(webhookUrl, 'webhookUrl');
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createGoogleChatConfig };
