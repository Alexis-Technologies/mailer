// Not ported: the options of the Meta transport: a block per channel it
// sends (the number of WhatsApp, the page of Messenger, the account of
// Instagram), each with its token or the shared one, and the version of the
// Graph API.

const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

// The version of the Graph API the transport was written against (May
// 2025); each lives two years.
const DEFAULT_GRAPH_VERSION = 'v23.0';
const VERSION = /^v\d{1,3}\.\d$/;
const NUMERIC_ID = /^\d{1,32}$/;
const TOKEN = /^\S+$/;
const BLOCKS = [
  ['whatsapp', 'phoneNumberId'],
  ['messenger', 'pageId'],
  ['instagram', 'accountId'],
];

const checkToken = (value, name) => {
  if (typeof value !== 'string' || !TOKEN.test(value)) {
    throw new TypeError(`MetaTransport needs ${name}, a token without spaces.`);
  }
  return value;
};

/**
 * Resolves the options of the Meta transport.
 *
 * @param config The options.
 * @returns The options with their defaults, `channels` the blocks by channel,
 * a dictionary rather than a Map so that their tokens are redacted.
 * @throws {TypeError} If an option is invalid, or no channel is given.
 * @internal
 */
const createMetaConfig = (config = {}) => {
  const channels = Object.create(null);
  let count = 0;
  for (const [channel, idName] of BLOCKS) {
    const block = config[channel];
    if (block === undefined) continue;
    const id = block?.[idName];
    if (typeof id !== 'string' || !NUMERIC_ID.test(id)) {
      throw new TypeError(`MetaTransport needs ${channel}.${idName}, a numeric id.`);
    }
    const token = block.accessToken ?? config.accessToken;
    channels[channel] = {
      id,
      accessToken: checkToken(token, `${channel}.accessToken or accessToken`),
    };
    count++;
  }
  if (count === 0) {
    throw new TypeError('MetaTransport needs whatsapp, messenger or instagram.');
  }
  const graphVersion = config.graphVersion ?? DEFAULT_GRAPH_VERSION;
  if (typeof graphVersion !== 'string' || !VERSION.test(graphVersion)) {
    throw new TypeError(
      `graphVersion of MetaTransport is a version of Graph, such as ${DEFAULT_GRAPH_VERSION}.`,
    );
  }
  const resolved = {
    channels,
    accessToken: config.accessToken,
    graphVersion,
    baseUrl: config.baseUrl ?? 'https://graph.facebook.com',
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

module.exports = { DEFAULT_GRAPH_VERSION, createMetaConfig };
