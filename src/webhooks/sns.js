// Not ported: the messages of the SNS protocol, which Amazon SNS and
// Scaleway's Topics and Events post to a webhook: their topic, signature
// (versions 1 and 2), certificate, time and id, verified before their
// message is read
// (https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html).

const { X509Certificate, verify: verifySignature } = require('node:crypto');
const { readText } = require('../internal/body.js');
const { checkOptionalFunction, checkPositiveNumber } = require('../internal/options.js');
const {
  WebhookVerificationError,
  bodyBytesOf,
  checkTime,
  claimDelivery,
  isRecord,
  parseJsonOf,
  resolveCommonOptions,
} = require('./request.js');

const MAX_CERTIFICATE_BYTES = 64 * 1024;
const MAX_CERTIFICATES = 32;
// A message of a listed topic makes the verifier read its certificate before
// the signature can be checked, so a few reads at a time are made, and the
// next is refused for the provider to try again, rather than a crowd of them.
const MAX_LOADING = 4;
const DEFAULT_CERTIFICATE_TIMEOUT_MS = 10_000;
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
 * or credentials, and with a path the other pattern takes and no query or
 * fragment when one is given.
 *
 * @internal
 */
const isHttpsUrlOf = (value, host, path) => {
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
    url.password === '' &&
    (path === undefined || (path.test(url.pathname) && url.search === '' && url.hash === ''))
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

const certificateError = (message, cause, status) =>
  new WebhookVerificationError('certificate', message, { cause, status });

// A certificate that could not be read may be read on the provider's next
// delivery, so the answer asks for one.
const UNREAD = 503;

const loadCertificate = async (fetchOption, url, timeoutMs) => {
  const fetch = fetchOption ?? globalThis.fetch;
  let response;
  try {
    response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw certificateError('The signing certificate could not be read.', error, UNREAD);
  }
  if (!response.ok) {
    throw certificateError(
      `The signing certificate answered HTTP ${response.status}.`,
      undefined,
      UNREAD,
    );
  }
  try {
    return new X509Certificate(await readText(response, MAX_CERTIFICATE_BYTES));
  } catch (error) {
    throw certificateError('The signing certificate is not one.', error);
  }
};

// The certificates by URL: each read once while it is cached, the oldest
// dropped past MAX_CERTIFICATES, one that failed to load not kept, and no
// more than MAX_LOADING read at once.
const createCertificateCache = (fetchOption, trust, timeoutMs) => {
  const certificates = new Map();
  let loading = 0;
  return (url) => {
    let pending = certificates.get(url);
    if (pending !== undefined) return pending;
    if (loading >= MAX_LOADING) {
      return Promise.reject(
        certificateError('Too many signing certificates are being read.', undefined, UNREAD),
      );
    }
    loading++;
    pending = loadCertificate(fetchOption, url, timeoutMs)
      .then((certificate) => {
        trust(certificate);
        return certificate;
      })
      .finally(() => {
        loading--;
      });
    pending.catch(() => certificates.delete(url));
    certificates.set(url, pending);
    if (certificates.size > MAX_CERTIFICATES) {
      certificates.delete(certificates.keys().next().value);
    }
    return pending;
  };
};

const checkSignature = async (message, certificateOf, service, algorithms, common) => {
  const fields = SIGNED_FIELDS.get(message.Type);
  if (fields === undefined) {
    throw new WebhookVerificationError(
      'payload',
      `The SNS message type ${message.Type} is unknown.`,
    );
  }
  const algorithm = algorithms.get(message.SignatureVersion);
  if (algorithm === undefined || typeof message.Signature !== 'string') {
    throw new WebhookVerificationError(
      'signature',
      'The SNS signature version is unknown, or not taken.',
    );
  }
  const url = message.SigningCertURL;
  if (typeof url !== 'string' || !service.isCertificateUrl(url)) {
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

// The algorithms of the signature versions taken: both by default, as a
// topic signs with version 1, SHA1, unless it is set to sign with 2.
const algorithmsOf = (versions) => {
  if (versions === undefined) return ALGORITHMS;
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new TypeError("signatureVersions lists the versions taken, '1' or '2'.");
  }
  const algorithms = new Map();
  for (const version of versions) {
    const algorithm = ALGORITHMS.get(version);
    if (algorithm === undefined) {
      throw new TypeError(`signatureVersions takes '1' or '2': ${String(version)}`);
    }
    algorithms.set(version, algorithm);
  }
  return algorithms;
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
 * Makes the verification of SNS messages: `verify(request)` gives the
 * delivery of the events of a notification, or of the `confirmation` of a
 * subscription message, under the id of the SNS message.
 *
 * @param options `topicArns`, `fetch`, `signatureVersions`,
 * `certificateTimeoutMs`, and the options every verifier takes.
 * @param service `provider`, `defaultToleranceMs`, `isCertificateUrl` and
 * `isSubscribeUrl` (where its certificates and subscriptions are),
 * `trust(certificate)`, which throws for a certificate the service did not
 * issue, and `eventsOf(message, record)`, the events of a notification,
 * `record` its parsed message when it is a JSON object.
 * @internal
 */
const createSnsVerifier = (options, service) => {
  const topics = topicsOf(options.topicArns);
  const common = resolveCommonOptions(options, service.defaultToleranceMs);
  const algorithms = algorithmsOf(options.signatureVersions);
  const certificateOf = createCertificateCache(
    checkOptionalFunction(options.fetch, 'fetch'),
    service.trust ?? (() => {}),
    checkPositiveNumber(
      options.certificateTimeoutMs ?? DEFAULT_CERTIFICATE_TIMEOUT_MS,
      'certificateTimeoutMs',
    ),
  );
  return async (request) => {
    const message = parseJsonOf(bodyBytesOf(request, common));
    if (!isRecord(message) || typeof message.TopicArn !== 'string') {
      throw new WebhookVerificationError('payload', 'The body is not an SNS message.');
    }
    if (!topics.has(message.TopicArn)) {
      throw new WebhookVerificationError('topic', `The topic ${message.TopicArn} is not taken.`);
    }
    await checkSignature(message, certificateOf, service, algorithms, common);
    checkTime(Date.parse(message.Timestamp), common);
    const key = `${service.provider}:${message.MessageId}`;
    if (message.Type !== 'Notification') {
      if (!service.isSubscribeUrl(message.SubscribeURL)) {
        throw new WebhookVerificationError(
          'payload',
          'The subscription URL is not of the service.',
        );
      }
      return claimDelivery(common, [{ key, events: [] }], {
        confirmation: {
          type: message.Type,
          topicArn: message.TopicArn,
          subscribeUrl: message.SubscribeURL,
          token: message.Token,
          message: message.Message,
        },
      });
    }
    let record;
    try {
      record = JSON.parse(message.Message);
    } catch {
      record = undefined;
    }
    const events = service.eventsOf(message, isRecord(record) ? record : undefined);
    return claimDelivery(common, [{ key, events }]);
  };
};

module.exports = { certificateError, createSnsVerifier, isHttpsUrlOf };
