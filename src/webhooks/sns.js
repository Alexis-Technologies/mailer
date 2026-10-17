// Not ported: the messages of the SNS protocol, which Amazon SNS and
// Scaleway's Topics and Events post to a webhook: their topic, signature
// (versions 1 and 2), certificate, time and id, verified before their
// message is read
// (https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html).

const { X509Certificate, verify: verifySignature } = require('node:crypto');
const { readText } = require('../internal/body.js');
const { checkOptionalFunction } = require('../internal/options.js');
const {
  WebhookVerificationError,
  bodyBytesOf,
  checkReplay,
  checkTime,
  isRecord,
  parseJsonOf,
  resolveCommonOptions,
} = require('./request.js');

const MAX_CERTIFICATE_BYTES = 64 * 1024;
const MAX_CERTIFICATES = 32;
const ALGORITHMS = new Map([
  ['1', 'RSA-SHA1'],
  ['2', 'RSA-SHA256'],
]);
// The fields signed, in order, by type of message.
const SUBSCRIPTION_FIELDS = [
  'Message',
  'MessageId',
  'SubscribeURL',
  'Timestamp',
  'Token',
  'TopicArn',
  'Type',
];
const SIGNED_FIELDS = new Map([
  ['Notification', ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']],
  ['SubscriptionConfirmation', SUBSCRIPTION_FIELDS],
  ['UnsubscribeConfirmation', SUBSCRIPTION_FIELDS],
]);

/**
 * Whether a value is an HTTPS URL on a host the pattern takes, with no port
 * or credentials.
 *
 * @internal
 */
const isHttpsUrlOf = (value, host) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    host.test(url.hostname) &&
    url.port === '' &&
    url.username === '' &&
    url.password === ''
  );
};

const stringToSign = (message, fields) => {
  let text = '';
  for (const field of fields) {
    const value = message[field];
    if (value === undefined && field === 'Subject') continue;
    if (typeof value !== 'string') {
      throw new WebhookVerificationError('payload', `The SNS message has no ${field}.`);
    }
    text += `${field}\n${value}\n`;
  }
  return text;
};

const certificateError = (message, cause) =>
  new WebhookVerificationError('certificate', message, cause === undefined ? undefined : { cause });

const loadCertificate = async (fetchOption, url) => {
  const fetch = fetchOption ?? globalThis.fetch;
  let response;
  try {
    response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    throw certificateError('The signing certificate could not be read.', error);
  }
  if (!response.ok) {
    throw certificateError(`The signing certificate answered HTTP ${response.status}.`);
  }
  try {
    return new X509Certificate(await readText(response, MAX_CERTIFICATE_BYTES));
  } catch (error) {
    throw certificateError('The signing certificate is not one.', error);
  }
};

// The certificates by URL: each read once while it is cached, the oldest
// dropped past MAX_CERTIFICATES, one that failed to load not kept.
const createCertificateCache = (fetchOption, trust) => {
  const certificates = new Map();
  return (url) => {
    let pending = certificates.get(url);
    if (pending === undefined) {
      pending = loadCertificate(fetchOption, url).then((certificate) => {
        trust(certificate);
        return certificate;
      });
      pending.catch(() => certificates.delete(url));
      certificates.set(url, pending);
      if (certificates.size > MAX_CERTIFICATES) {
        certificates.delete(certificates.keys().next().value);
      }
    }
    return pending;
  };
};

const checkSignature = async (message, certificateOf, isCertificateUrl, common) => {
  const fields = SIGNED_FIELDS.get(message.Type);
  if (fields === undefined) {
    throw new WebhookVerificationError(
      'payload',
      `The SNS message type ${message.Type} is unknown.`,
    );
  }
  const algorithm = ALGORITHMS.get(message.SignatureVersion);
  if (algorithm === undefined || typeof message.Signature !== 'string') {
    throw new WebhookVerificationError('signature', 'The SNS signature version is unknown.');
  }
  if (typeof message.SigningCertURL !== 'string' || !isCertificateUrl(message.SigningCertURL)) {
    throw certificateError('The signing certificate is not on a host of the service.');
  }
  const text = stringToSign(message, fields);
  const certificate = await certificateOf(message.SigningCertURL);
  const now = common.now();
  if (now < Date.parse(certificate.validFrom) || now > Date.parse(certificate.validTo)) {
    throw certificateError('The signing certificate is not valid now.');
  }
  const signature = Buffer.from(message.Signature, 'base64');
  if (!verifySignature(algorithm, Buffer.from(text, 'utf8'), certificate.publicKey, signature)) {
    throw new WebhookVerificationError('signature', 'The SNS signature does not match.');
  }
};

const topicsOf = (topicArns) => {
  if (!Array.isArray(topicArns) || topicArns.length === 0) {
    throw new TypeError('topicArns must list the topics the verifier takes.');
  }
  const topics = new Set();
  for (const arn of topicArns) {
    if (typeof arn !== 'string' || arn === '') throw new TypeError('A topic ARN is a string.');
    topics.add(arn);
  }
  return topics;
};

/**
 * Makes the verification of SNS messages: `verify(request)` gives `{ message,
 * record }` for a notification, `record` its parsed message when it is a JSON
 * object, or `{ message, confirmation }` for a subscription message.
 *
 * @param options `topicArns`, `fetch`, and the options every verifier takes.
 * @param service `provider`, `defaultToleranceMs`, `isCertificateUrl` (the
 * hosts of certificates and subscriptions), and `trust(certificate)`, which
 * throws for a certificate the service did not issue.
 * @internal
 */
const createSnsVerifier = (options, service) => {
  const topics = topicsOf(options.topicArns);
  const common = resolveCommonOptions(options, service.defaultToleranceMs);
  const certificateOf = createCertificateCache(
    checkOptionalFunction(options.fetch, 'fetch'),
    service.trust ?? (() => {}),
  );
  return async (request) => {
    const message = parseJsonOf(bodyBytesOf(request, common));
    if (!isRecord(message) || typeof message.TopicArn !== 'string') {
      throw new WebhookVerificationError('payload', 'The body is not an SNS message.');
    }
    if (!topics.has(message.TopicArn)) {
      throw new WebhookVerificationError('topic', `The topic ${message.TopicArn} is not taken.`);
    }
    await checkSignature(message, certificateOf, service.isCertificateUrl, common);
    checkTime(Date.parse(message.Timestamp), common);
    await checkReplay(common, `${service.provider}:${message.MessageId}`);
    if (message.Type !== 'Notification') {
      if (!service.isCertificateUrl(message.SubscribeURL)) {
        throw new WebhookVerificationError(
          'payload',
          'The subscription URL is not of the service.',
        );
      }
      return {
        message,
        confirmation: {
          type: message.Type,
          topicArn: message.TopicArn,
          subscribeUrl: message.SubscribeURL,
          token: message.Token,
          message: message.Message,
        },
      };
    }
    let record;
    try {
      record = JSON.parse(message.Message);
    } catch {
      record = undefined;
    }
    return { message, record: isRecord(record) ? record : undefined };
  };
};

module.exports = { certificateError, createSnsVerifier, isHttpsUrlOf };
