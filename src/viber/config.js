// Not ported: the options of the Viber transport: the token of the bot and
// the sender its messages carry.

const { checkCredential } = require('../internal/api-steps.js');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

const MAX_SENDER_NAME = 28;

/**
 * Resolves the options of the Viber transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createViberConfig = (config = {}) => {
  const sender = config.sender;
  if (
    typeof sender?.name !== 'string' ||
    sender.name === '' ||
    sender.name.length > MAX_SENDER_NAME
  ) {
    throw new TypeError(
      `ViberTransport needs sender.name, the name a message shows, of ${MAX_SENDER_NAME} ` +
        'characters at most.',
    );
  }
  if (sender.avatar !== undefined) checkSecureUrl(sender.avatar, 'sender.avatar');
  const resolved = {
    authToken: checkCredential(config.authToken, 'authToken', 'ViberTransport'),
    sender:
      sender.avatar === undefined
        ? { name: sender.name }
        : { name: sender.name, avatar: sender.avatar },
    baseUrl: config.baseUrl ?? 'https://chatapi.viber.com',
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    concurrency: config.concurrency ?? 10,
    headers: config.headers ?? {},
    fetch: config.fetch,
    logger: config.logger,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.baseUrl, 'baseUrl');
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createViberConfig, MAX_SENDER_NAME };
