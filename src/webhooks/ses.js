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

const { bounceKindOf, createEvent, dateOf, isRecord, stringOf } = require('./request.js');
const { createSnsVerifier, isHttpsUrlOf } = require('./sns.js');

// SNS retries a delivery with the time it was published, for up to an hour
// by default.
const DEFAULT_TOLERANCE_MS = 60 * 60 * 1000;
const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
// The tags SES writes itself, and the one `./ses` writes for the priority.
const OWN_TAG = /^(ses|aws):/;

// The certificates and subscriptions of SNS are on its hosts, over HTTPS.
const isSnsUrl = (value) => isHttpsUrlOf(value, SNS_HOST);

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
  const kind = bounceKindOf(bounce.bounceType);
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

/**
 * Makes the verifier of the SNS messages of Amazon SES.
 *
 * @param options `topicArns`, the topics taken; `replayStore`; `fetch`, for
 * the signing certificates; `now`, `toleranceMs` (an hour), `leaseMs` and
 * `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events, confirmation?,
 * commit, release }`.
 * @throws {TypeError} If an option is invalid.
 */
const createSesWebhookVerifier = (options = {}) => ({
  /**
   * Verifies an SNS message and reads its events.
   *
   * @param request `body`, the raw body, and `headers`.
   * @returns The delivery of its events, and `confirmation` for a
   * subscription message.
   * @throws {WebhookVerificationError} If the message is refused.
   */
  verify: createSnsVerifier(options, {
    provider: 'ses',
    defaultToleranceMs: DEFAULT_TOLERANCE_MS,
    isCertificateUrl: isSnsUrl,
    eventsOf: (message, record) =>
      record === undefined
        ? [
            createEvent({
              provider: 'ses',
              type: 'unknown',
              id: `${message.MessageId}:0`,
              raw: message,
            }),
          ]
        : eventsOf(record, message.MessageId),
  }),
});

module.exports = { createSesWebhookVerifier };
