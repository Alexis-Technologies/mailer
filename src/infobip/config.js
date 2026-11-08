// Not ported: the options of the Infobip transport: the key of the API, the
// base URL of the account, the sender and the URL of its delivery reports.

const { checkCredential } = require('../internal/api-steps.js');
const { checkWebhookUrl } = require('../internal/channel/webhook-url.js');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const HOST = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);

// The base URL of the account: the host Infobip gives it
// (`xyz123.api.infobip.com`), which becomes an https URL, or a URL. A host
// is held to a name of DNS labels, as it goes into the URL the key is sent
// to, and is not echoed: a secret pasted by mistake could be in it.
const baseUrlOf = (value) => {
  if (value.includes('://')) {
    checkSecureUrl(value, 'baseUrl');
    return value.endsWith('/') ? value.slice(0, -1) : value;
  }
  if (value.length > 253 || !HOST.test(value)) {
    throw new TypeError(
      'InfobipTransport: baseUrl must be the host of the account, such as ' +
        '"xyz123.api.infobip.com", or an https URL.',
    );
  }
  return `https://${value}`;
};

/**
 * Resolves the options of the Infobip transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createInfobipConfig = (config = {}) => {
  const resolved = {
    apiKey: checkCredential(config.apiKey, 'apiKey', 'InfobipTransport'),
    baseUrl: baseUrlOf(checkCredential(config.baseUrl, 'baseUrl', 'InfobipTransport')),
    from: config.from,
    notifyUrl: config.notifyUrl,
    timeout: config.timeout ?? 30000,
    retries: config.retries ?? 3,
    concurrency: config.concurrency ?? 10,
    headers: config.headers ?? {},
    fetch: config.fetch,
    logger: config.logger,
    now: config.now ?? Date.now,
  };
  checkRequestOptions(resolved.timeout, resolved.retries);
  if (resolved.notifyUrl !== undefined) checkWebhookUrl(resolved.notifyUrl, 'notifyUrl');
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createInfobipConfig };
