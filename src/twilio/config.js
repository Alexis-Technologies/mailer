// Ported from @thinwrap/notifications v1.2.0 (src/providers/twilio/twilio.connector.ts):
// the host of the Messages API of a region and an edge of Twilio, from the
// closed lists they are written into a host name of.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: the options of a transport, its credentials (an auth
// token or an API key), its senders and its status callback.

const { checkCredential } = require('../internal/api-steps.js');
const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');
const { checkWebhookUrl } = require('../internal/channel/webhook-url.js');

const REGIONS = new Set(['us1', 'ie1', 'au1']);
const DEFAULT_EDGES = new Map([
  ['ie1', 'dublin'],
  ['au1', 'sydney'],
]);
const EDGES = new Set([
  'sydney',
  'sao-paulo',
  'dublin',
  'frankfurt',
  'tokyo',
  'singapore',
  'ashburn',
  'umatilla',
  'roaming',
]);
const ACCOUNT_SID = /^AC[0-9a-f]{32}$/;
const API_KEY_SID = /^SK[0-9a-f]{32}$/;
const MESSAGING_SERVICE_SID = /^MG[0-9a-f]{32}$/;

/**
 * The host of the Messages API of a region and an edge.
 *
 * @throws {TypeError} If either is not one of Twilio.
 * @internal
 */
const hostOf = (region = 'us1', edge) => {
  if (!REGIONS.has(region)) {
    throw new TypeError(`region of TwilioTransport is us1, ie1 or au1, not ${region}.`);
  }
  if (edge !== undefined && !EDGES.has(edge)) {
    throw new TypeError(`Unknown edge of Twilio: ${edge}.`);
  }
  if (region === 'us1') return edge === undefined ? 'api.twilio.com' : `api.${edge}.us1.twilio.com`;
  return `api.${edge ?? DEFAULT_EDGES.get(region)}.${region}.twilio.com`;
};

/**
 * Resolves the options of the Twilio transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createTwilioConfig = (config = {}) => {
  const accountSid = checkCredential(config.accountSid, 'accountSid', 'TwilioTransport');
  if (!ACCOUNT_SID.test(accountSid)) {
    throw new TypeError('accountSid of TwilioTransport is AC and 32 hex digits.');
  }
  let username = accountSid;
  let password;
  if (config.apiKey === undefined) {
    password = checkCredential(config.authToken, 'authToken or apiKey', 'TwilioTransport');
  } else {
    if (typeof config.apiKey?.sid !== 'string' || !API_KEY_SID.test(config.apiKey.sid)) {
      throw new TypeError('apiKey.sid of TwilioTransport is SK and 32 hex digits.');
    }
    username = config.apiKey.sid;
    password = checkCredential(config.apiKey.secret, 'apiKey.secret', 'TwilioTransport');
  }
  const messagingServiceSid = config.messagingServiceSid;
  if (messagingServiceSid !== undefined && !MESSAGING_SERVICE_SID.test(messagingServiceSid)) {
    throw new TypeError('messagingServiceSid of TwilioTransport is MG and 32 hex digits.');
  }
  const resolved = {
    accountSid,
    username,
    password,
    from: config.from,
    whatsappFrom: config.whatsappFrom,
    rcsFrom: config.rcsFrom,
    messagingServiceSid,
    statusCallback: config.statusCallback,
    baseUrl: config.baseUrl ?? `https://${hostOf(config.region, config.edge)}`,
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
  if (resolved.statusCallback !== undefined) {
    checkWebhookUrl(resolved.statusCallback, 'statusCallback');
  }
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createTwilioConfig, hostOf };
