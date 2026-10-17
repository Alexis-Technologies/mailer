// Not ported: the events of Scaleway Transactional Email, which Scaleway's
// Topics and Events, an implementation of the SNS protocol, posts to a
// webhook (https://www.scaleway.com/en/docs/transactional-email/reference-content/webhook-events-payloads/).
// sently and unemail have no Scaleway webhook.

const { X509Certificate } = require('node:crypto');
const {
  createEvent,
  dateOf,
  headerValueOf,
  metadataFromHeaders,
  stringOf,
} = require('./request.js');
const { certificateError, createSnsVerifier, isHttpsUrlOf } = require('./sns.js');

const DEFAULT_TOLERANCE_MS = 60 * 60 * 1000;
const SCALEWAY_HOST = /(^|\.)(scw\.cloud|scaleway\.com)$/;
const isScalewayUrl = (value) => isHttpsUrlOf(value, SCALEWAY_HOST);
const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[^-]+-----END CERTIFICATE-----/g;
const TYPES = new Map([
  ['email_queued', 'accepted'],
  ['email_delivered', 'delivered'],
  ['email_deferred', 'deferred'],
  ['email_dropped', 'bounced'],
  ['email_mailbox_not_found', 'bounced'],
  ['email_blocklisted', 'rejected'],
  ['email_spam', 'complained'],
]);

// The certificates of the trust chain the application pins, as Scaleway
// asks a certificate to be checked against it rather than trusted.
const trustChainOf = (pem) => {
  if (typeof pem !== 'string') {
    throw new TypeError("trustChain is the PEM of Scaleway's SNS trust chain.");
  }
  const authorities = [];
  for (const match of pem.matchAll(PEM_CERTIFICATE)) {
    authorities.push(new X509Certificate(match[0]));
  }
  if (authorities.length === 0) throw new TypeError('trustChain holds no certificate.');
  return authorities;
};

const eventOf = (record, snsMessageId) => {
  const type = TYPES.get(record.type) ?? 'unknown';
  let bounce;
  if (type === 'bounced' || type === 'deferred') {
    bounce = { kind: type === 'bounced' ? 'hard' : 'soft' };
    if (record.email_response_code !== undefined && record.email_response_code !== null) {
      bounce.code = String(record.email_response_code);
    }
    const diagnostic = stringOf(record.email_response_message) ?? stringOf(record.email_error);
    if (diagnostic !== undefined) bounce.diagnostic = diagnostic;
  }
  return createEvent({
    provider: 'scaleway',
    type,
    id: stringOf(record.id) ?? snsMessageId,
    messageId: stringOf(record.email_id),
    rfcMessageId: headerValueOf(record.email_headers, 'message-id'),
    recipient: stringOf(record.email_to),
    occurredAt: dateOf(record.created_at),
    bounce,
    reason: stringOf(record.blocklist_reason) ?? stringOf(record.blocklist_type),
    metadata: metadataFromHeaders(record.email_headers),
    raw: record,
  });
};

/**
 * Makes the verifier of the events of Scaleway Transactional Email, posted by
 * Topics and Events: an SNS message from a listed topic, signed with a
 * certificate on a Scaleway host that the trust chain the application pins
 * issued, published within an hour, taken once.
 *
 * @param options `topicArns`; `trustChain`, the PEM of Scaleway's SNS trust
 * chain; `replayStore`; `fetch`, `now`, `toleranceMs`, `leaseMs` and
 * `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events, confirmation?,
 * commit, release }`.
 * @throws {TypeError} If an option is invalid.
 */
const createScalewayWebhookVerifier = (options = {}) => {
  const authorities = trustChainOf(options.trustChain);
  const verify = createSnsVerifier(options, {
    provider: 'scaleway',
    defaultToleranceMs: DEFAULT_TOLERANCE_MS,
    // Scaleway documents no form of its certificate URLs: the trust chain,
    // not the host, is what a certificate is taken by.
    isCertificateUrl: isScalewayUrl,
    isSubscribeUrl: isScalewayUrl,
    trust: (certificate) => {
      for (const authority of authorities) {
        if (certificate.checkIssued(authority) && certificate.verify(authority.publicKey)) return;
      }
      throw certificateError('The signing certificate was not issued by the trust chain.');
    },
    eventsOf: (message, record) => [
      record === undefined
        ? createEvent({
            provider: 'scaleway',
            type: 'unknown',
            id: message.MessageId,
            raw: message,
          })
        : eventOf(record, message.MessageId),
    ],
  });
  return { verify };
};

module.exports = { createScalewayWebhookVerifier };
