// Not ported: the options of the Teams transport: the URL of a webhook of
// Workflows, the app of a bot of the Bot Framework, or both, and the service
// URLs the token of the bot may go to.

const { checkCredential } = require('../internal/api-steps.js');
const { checkWebhookUrl } = require('../internal/channel/webhook-url.js');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

// A tenant of Microsoft Entra, its id or its domain, which goes into the
// path of the token endpoint.
const TENANT = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;

const botOf = (bot) => {
  if (bot === undefined) return undefined;
  const resolved = {
    appId: checkCredential(bot.appId, 'bot.appId', 'TeamsTransport'),
    clientSecret: checkCredential(bot.clientSecret, 'bot.clientSecret', 'TeamsTransport'),
    tenantId: bot.tenantId,
  };
  if (resolved.tenantId !== undefined && !TENANT.test(resolved.tenantId)) {
    throw new TypeError('TeamsTransport: bot.tenantId must be the id or the domain of a tenant.');
  }
  return resolved;
};

// The scope of the token of a bot: of the Bot Framework of the clouds of the
// government of the US when the token comes from their Entra, else public.
const scopeOf = (tokenUrl) =>
  URL.canParse(tokenUrl) && new URL(tokenUrl).hostname.endsWith('.us')
    ? 'https://api.botframework.us/.default'
    : 'https://api.botframework.com/.default';

// The origins of service URLs the token may go to beyond those of Teams.
const originsOf = (urls) => {
  const origins = new Set();
  if (urls === undefined) return origins;
  for (const url of urls) {
    checkSecureUrl(url, 'serviceUrls');
    origins.add(new URL(url).origin);
  }
  return origins;
};

/**
 * Resolves the options of the Teams transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid, or neither credential given.
 * @internal
 */
const createTeamsConfig = (config = {}) => {
  const webhookUrl =
    config.webhookUrl === undefined
      ? undefined
      : checkCredential(config.webhookUrl, 'webhookUrl', 'TeamsTransport');
  const bot = botOf(config.bot);
  if (webhookUrl === undefined && bot === undefined) {
    throw new TypeError('TeamsTransport needs webhookUrl, bot or both.');
  }
  const tenant = bot?.tenantId ?? 'botframework.com';
  const tokenUrl =
    config.tokenUrl ?? `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const resolved = {
    webhookUrl,
    bot,
    tokenUrl,
    scope: config.scope ?? scopeOf(tokenUrl),
    serviceOrigins: originsOf(config.serviceUrls),
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    concurrency: config.concurrency ?? 5,
    headers: config.headers ?? {},
    fetch: config.fetch,
    generateId: config.generateId,
    logger: config.logger,
    now: config.now ?? Date.now,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  checkSecureUrl(resolved.tokenUrl, 'tokenUrl');
  if (webhookUrl !== undefined) checkWebhookUrl(webhookUrl, 'webhookUrl');
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createTeamsConfig };
