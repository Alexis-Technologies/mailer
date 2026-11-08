// Not ported: the options of the Discord transport: the token of its bot for
// the REST API, the URL of a webhook, or both.

const { checkCredential } = require('../internal/api-steps.js');
const { checkWebhookUrl } = require('../internal/channel/webhook-url.js');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

const NO_SPACE = /^\S+$/;

/**
 * Resolves the options of the Discord transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid, or neither credential given.
 * @internal
 */
const createDiscordConfig = (config = {}) => {
  const botToken =
    config.botToken === undefined
      ? undefined
      : checkCredential(config.botToken, 'botToken', 'DiscordTransport');
  const webhookUrl =
    config.webhookUrl === undefined
      ? undefined
      : checkCredential(config.webhookUrl, 'webhookUrl', 'DiscordTransport');
  if (botToken === undefined && webhookUrl === undefined) {
    throw new TypeError('DiscordTransport needs botToken, webhookUrl or both.');
  }
  if (botToken !== undefined && !NO_SPACE.test(botToken)) {
    throw new TypeError('botToken of DiscordTransport is no token: it holds a space.');
  }
  const resolved = {
    botToken,
    webhookUrl,
    baseUrl: config.baseUrl ?? 'https://discord.com/api/v10',
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    concurrency: config.concurrency ?? 5,
    headers: config.headers ?? {},
    fetch: config.fetch,
    generateId: config.generateId,
    logger: config.logger,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  if (webhookUrl !== undefined) checkWebhookUrl(webhookUrl, 'webhookUrl');
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createDiscordConfig };
