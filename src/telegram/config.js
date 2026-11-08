// Not ported: the options of the Telegram transport, the token of its bot,
// the markup of its texts, and the Bot API server it sends through.

const { checkCredential } = require('../internal/api-steps.js');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

// A token as BotFather gives it, `<bot id>:<secret>`: the path of every
// request, so that nothing else can move a request to another one.
const BOT_TOKEN = /^\d{1,20}:[\w-]{20,200}$/;
const PARSE_MODES = new Set(['HTML', 'MarkdownV2']);

/**
 * Resolves the options of the Telegram transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createTelegramConfig = (config = {}) => {
  const botToken = checkCredential(config.botToken, 'botToken', 'TelegramTransport');
  if (!BOT_TOKEN.test(botToken)) {
    throw new TypeError('botToken of TelegramTransport is no token of a bot: <id>:<secret>.');
  }
  if (config.parseMode !== undefined && !PARSE_MODES.has(config.parseMode)) {
    throw new TypeError("parseMode of TelegramTransport is 'HTML' or 'MarkdownV2'.");
  }
  const resolved = {
    botToken,
    baseUrl: config.baseUrl ?? 'https://api.telegram.org',
    parseMode: config.parseMode,
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
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

module.exports = { createTelegramConfig };
