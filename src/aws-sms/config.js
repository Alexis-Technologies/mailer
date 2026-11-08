// Not ported: the options of the transport of AWS End User Messaging SMS:
// the credentials (or a function that gives them, for those of a role), the
// region, the sender and the configuration set.

const { checkConcurrency, checkRequestOptions, checkSecureUrl } = require('../internal/config.js');

// An AWS region, such as us-east-1, eu-central-1 or us-gov-west-1: it goes
// into the host the signed request is sent to.
const AWS_REGION = /^[a-z]{2}(?:-[a-z]+)+-\d+$/;
const MESSAGE_TYPES = new Set(['TRANSACTIONAL', 'PROMOTIONAL']);

const checkCredentials = (credentials) => {
  if (typeof credentials === 'function') return credentials;
  if (
    typeof credentials?.accessKeyId !== 'string' ||
    credentials.accessKeyId === '' ||
    typeof credentials.secretAccessKey !== 'string' ||
    credentials.secretAccessKey === ''
  ) {
    throw new TypeError(
      'AwsSmsTransport needs credentials: { accessKeyId, secretAccessKey, sessionToken }, or a function that gives them.',
    );
  }
  return credentials;
};

/**
 * Resolves the options of the AWS SMS transport.
 *
 * @param config The options.
 * @returns The options with their defaults.
 * @throws {TypeError} If an option is invalid.
 * @internal
 */
const createAwsSmsConfig = (config = {}) => {
  const region = config.region ?? 'us-east-1';
  if (typeof region !== 'string' || !AWS_REGION.test(region)) {
    throw new TypeError(`Invalid AWS region: ${String(region)}`);
  }
  const messageType = config.messageType ?? 'TRANSACTIONAL';
  if (!MESSAGE_TYPES.has(messageType)) {
    throw new TypeError("messageType of AwsSmsTransport is 'TRANSACTIONAL' or 'PROMOTIONAL'.");
  }
  const resolved = {
    credentials: checkCredentials(config.credentials),
    region,
    originationIdentity: config.originationIdentity,
    configurationSetName: config.configurationSetName,
    messageType,
    baseUrl: config.baseUrl ?? `https://sms-voice.${region}.amazonaws.com`,
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
  checkConcurrency(resolved.concurrency);
  return resolved;
};

module.exports = { createAwsSmsConfig };
