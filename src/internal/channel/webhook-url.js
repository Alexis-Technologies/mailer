// Not ported: the check of the URL of a webhook of a work chat (Slack,
// Discord, Teams, Google Chat), which is its credential: HTTPS, or plain HTTP
// to this machine, as checkSecureUrl holds a URL of a provider, but never
// written into the error, which would put the secret into a log.

const { isLoopbackHost } = require('../loopback.js');

/**
 * Checks the URL of a webhook without showing it.
 *
 * @param value The URL, as configured.
 * @param name The option it comes from, for the error.
 * @returns The URL, parsed.
 * @throws {TypeError} If it is not a URL, or neither HTTPS nor loopback HTTP.
 * @internal
 */
const checkWebhookUrl = (value, name) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`\`${name}\` must be a URL; it is a credential, not shown here.`);
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return url;
  throw new TypeError(
    `\`${name}\` must use HTTPS, or plain HTTP only to a loopback host; it is a credential, ` +
      'not shown here.',
  );
};

module.exports = { checkWebhookUrl };
