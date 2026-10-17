// Ported from sently v1.2.2 (src/webhooks/ses.ts): the events of Amazon SES,
// delivered by SNS, `SES_EVENT_MAP` and `parse`.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: the SNS message is verified — its topic against a
// list the application gives, its signature (versions 1 and 2) with the
// certificate of an `sns.<region>.amazonaws.com` URL, its time and its id —
// where sently parsed it unverified; a subscription confirmation is handed to
// the caller; a bounce, a complaint, a delivery or a delay is an event per
// recipient, where sently made one of the first; a bounce says whether it is
// hard or soft; and a reject or a rendering failure is `rejected`, not
// `bounced`.

const { X509Certificate, verify: verifySignature } = require('node:crypto');
const { readText } = require('../internal/body.js');
const { checkOptionalFunction } = require('../internal/options.js');
const {
  WebhookVerificationError,
  bodyBytesOf,
  checkReplay,
  checkTime,
  createEvent,
  dateOf,
  isRecord,
  parseJsonOf,
  resolveCommonOptions,
  stringOf,
} = require('./request.js');

// SNS retries a delivery with the time it was published, for up to an hour
// by default.
const DEFAULT_TOLERANCE_MS = 60 * 60 * 1000;
const MAX_CERTIFICATE_BYTES = 64 * 1024;
const MAX_CERTIFICATES = 32;
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const ALGORITHMS = new Map([
  ['1', 'RSA-SHA1'],
  ['2', 'RSA-SHA256'],
]);
// The fields signed, in order, by type of message.
const SIGNED_FIELDS = new Map([
  ['Notification', ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type']],
  [
    'SubscriptionConfirmation',
    ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  ],
  [
    'UnsubscribeConfirmation',
    ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  ],
]);
const BOUNCE_KINDS = new Map([
  ['Permanent', 'hard'],
  ['Transient', 'soft'],
]);
// The tags SES writes itself, and the one `./ses` writes for the priority.
const OWN_TAG = /^(ses|aws):/;

const isSnsUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    SNS_HOST.test(url.hostname) &&
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

// The tags and metadata of `mail.tags`: `category` holds the message's tags,
// as `./ses` sends them, and the others its metadata.
const tagsOf = (mail) => {
  const tags = [];
  const metadata = Object.create(null);
  if (!isRecord(mail?.tags)) return { tags, metadata };
  for (const name in mail.tags) {
    const values = mail.tags[name];
    if (!Array.isArray(values) || OWN_TAG.test(name) || name === 'priority') continue;
    if (name === 'category') {
      for (const value of values) {
        if (typeof value === 'string') tags.push(value);
      }
    } else if (typeof values[0] === 'string') {
      metadata[name] = values[0];
    }
  }
  return { tags, metadata };
};

// The recipients of an event, each `{ recipient, bounce?, reason? }`.
const recipientsOf = (list, read) => {
  const recipients = [];
  if (!Array.isArray(list)) return recipients;
  for (const item of list) {
    const recipient = read(item);
    if (recipient !== undefined) recipients.push(recipient);
  }
  return recipients;
};

const destinationsOf = (mail) =>
  recipientsOf(mail?.destination, (address) =>
    typeof address === 'string' ? { recipient: address } : undefined,
  );

// Open and click name no recipient: the destination, when it is one.
const onlyDestinationOf = (mail) => {
  const destinations = destinationsOf(mail);
  return destinations.length === 1 ? destinations : [{}];
};

const bounceOf = (bounce) => {
  const kind = BOUNCE_KINDS.get(bounce.bounceType) ?? 'undetermined';
  return recipientsOf(bounce.bouncedRecipients, (item) => {
    const recipient = stringOf(item?.emailAddress);
    if (recipient === undefined) return undefined;
    const details = { kind };
    if (stringOf(item.status) !== undefined) details.code = item.status;
    if (stringOf(item.diagnosticCode) !== undefined) details.diagnostic = item.diagnosticCode;
    return { recipient, bounce: details, reason: stringOf(bounce.bounceSubType) };
  });
};

const emailsOf = (list) =>
  recipientsOf(list, (item) => {
    const recipient = stringOf(item?.emailAddress);
    return recipient === undefined ? undefined : { recipient };
  });

// What an SES record says: its type, its recipients and when.
const describeRecord = (record) => {
  const mail = record.mail;
  const kind = stringOf(record.eventType) ?? stringOf(record.notificationType);
  switch (kind) {
    case 'Send':
      return { type: 'accepted', recipients: destinationsOf(mail), at: mail?.timestamp };
    case 'Delivery':
      return {
        type: 'delivered',
        recipients: recipientsOf(record.delivery?.recipients, (address) =>
          typeof address === 'string' ? { recipient: address } : undefined,
        ),
        at: record.delivery?.timestamp,
      };
    case 'Bounce':
      return {
        type: 'bounced',
        recipients: bounceOf(record.bounce ?? {}),
        at: record.bounce?.timestamp,
      };
    case 'Complaint':
      return {
        type: 'complained',
        recipients: emailsOf(record.complaint?.complainedRecipients),
        at: record.complaint?.timestamp,
        reason: stringOf(record.complaint?.complaintFeedbackType),
      };
    case 'DeliveryDelay':
      return {
        type: 'deferred',
        recipients: emailsOf(record.deliveryDelay?.delayedRecipients),
        at: record.deliveryDelay?.timestamp,
        reason: stringOf(record.deliveryDelay?.delayType),
      };
    case 'Reject':
      return {
        type: 'rejected',
        recipients: destinationsOf(mail),
        reason: stringOf(record.reject?.reason),
      };
    case 'Rendering Failure':
      return {
        type: 'rejected',
        recipients: destinationsOf(mail),
        reason: stringOf(record.failure?.errorMessage),
      };
    case 'Open':
      return { type: 'opened', recipients: onlyDestinationOf(mail), at: record.open?.timestamp };
    case 'Click':
      return {
        type: 'clicked',
        recipients: onlyDestinationOf(mail),
        at: record.click?.timestamp,
        url: stringOf(record.click?.link),
      };
    case 'Subscription':
      return {
        type:
          record.subscription?.newTopicPreferences?.unsubscribeAll === true
            ? 'unsubscribed'
            : 'unknown',
        recipients: onlyDestinationOf(mail),
        at: record.subscription?.timestamp,
      };
    default:
      return { type: 'unknown', recipients: onlyDestinationOf(mail), at: mail?.timestamp };
  }
};

// One event per recipient of an SES record.
const eventsOf = (record, snsMessageId) => {
  const described = describeRecord(record);
  const { tags, metadata } = tagsOf(record.mail);
  const recipients = described.recipients.length > 0 ? described.recipients : [{}];
  const events = [];
  for (let index = 0; index < recipients.length; index++) {
    const recipient = recipients[index];
    events.push(
      createEvent({
        provider: 'ses',
        type: described.type,
        id: `${snsMessageId}:${index}`,
        messageId: stringOf(record.mail?.messageId),
        recipient: recipient.recipient,
        occurredAt: dateOf(described.at ?? record.mail?.timestamp),
        bounce: recipient.bounce,
        reason: recipient.reason ?? described.reason,
        url: described.url,
        tags,
        metadata,
        raw: record,
      }),
    );
  }
  return events;
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
const createCertificateCache = (fetchOption) => {
  const certificates = new Map();
  return (url) => {
    let pending = certificates.get(url);
    if (pending === undefined) {
      pending = loadCertificate(fetchOption, url);
      pending.catch(() => certificates.delete(url));
      certificates.set(url, pending);
      if (certificates.size > MAX_CERTIFICATES) {
        certificates.delete(certificates.keys().next().value);
      }
    }
    return pending;
  };
};

const checkSignature = async (message, certificateOf, common) => {
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
  if (typeof message.SigningCertURL !== 'string' || !isSnsUrl(message.SigningCertURL)) {
    throw certificateError('The signing certificate is not one of SNS.');
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

/**
 * Makes the verifier of the SNS messages of Amazon SES.
 *
 * @param options `topicArns`, the topics taken; `fetch`, for the signing
 * certificates; `now`, `toleranceMs` (an hour), `replayStore` and
 * `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events, confirmation? }`.
 * @throws {TypeError} If an option is invalid.
 */
const createSesWebhookVerifier = (options = {}) => {
  const topicArns = options.topicArns;
  if (!Array.isArray(topicArns) || topicArns.length === 0) {
    throw new TypeError('topicArns must list the SNS topics the verifier takes.');
  }
  const topics = new Set();
  for (const arn of topicArns) {
    if (typeof arn !== 'string' || arn === '') throw new TypeError('A topic ARN is a string.');
    topics.add(arn);
  }
  const common = resolveCommonOptions(options, DEFAULT_TOLERANCE_MS);
  const certificateOf = createCertificateCache(checkOptionalFunction(options.fetch, 'fetch'));

  return {
    /**
     * Verifies an SNS message and reads its events.
     *
     * @param request `body`, the raw body, and `headers`.
     * @returns `{ events }`, and `confirmation` for a subscription message.
     * @throws {WebhookVerificationError} If the message is refused.
     */
    async verify(request) {
      const message = parseJsonOf(bodyBytesOf(request, common));
      if (!isRecord(message) || typeof message.TopicArn !== 'string') {
        throw new WebhookVerificationError('payload', 'The body is not an SNS message.');
      }
      if (!topics.has(message.TopicArn)) {
        throw new WebhookVerificationError('topic', `The topic ${message.TopicArn} is not taken.`);
      }
      await checkSignature(message, certificateOf, common);
      checkTime(Date.parse(message.Timestamp), common);
      await checkReplay(common, `ses:${message.MessageId}`);
      if (message.Type !== 'Notification') {
        if (!isSnsUrl(message.SubscribeURL)) {
          throw new WebhookVerificationError('payload', 'The subscription URL is not one of SNS.');
        }
        return {
          events: [],
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
      if (!isRecord(record)) {
        const event = createEvent({
          provider: 'ses',
          type: 'unknown',
          id: `${message.MessageId}:0`,
          raw: message,
        });
        return { events: [event] };
      }
      return { events: eventsOf(record, message.MessageId) };
    },
  };
};

module.exports = { createSesWebhookVerifier, isSnsUrl };
