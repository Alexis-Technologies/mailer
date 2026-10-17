// Not ported: the email events of Azure Communication Services, delivered by
// Event Grid (https://learn.microsoft.com/azure/event-grid/communication-services-email-events).
// sently and unemail have no Azure webhook.

const {
  DAY_REPLAY_TTL_MS,
  WebhookVerificationError,
  bodyBytesOf,
  claimDelivery,
  createEvent,
  dateOf,
  deliveryOf,
  headerOf,
  isRecord,
  parseJsonOf,
  resolveCommonOptions,
  stringOf,
  tokenCheckOf,
} = require('./request.js');

// Event Grid retries a delivery for a day: an event id is kept a day and an
// hour.
const VALIDATION = 'Microsoft.EventGrid.SubscriptionValidationEvent';
const DELIVERY = 'Microsoft.Communication.EmailDeliveryReportReceived';
const ENGAGEMENT = 'Microsoft.Communication.EmailEngagementTrackingReportReceived';
const DELIVERY_TYPES = new Map([
  ['Delivered', 'delivered'],
  ['Bounced', 'bounced'],
  ['Failed', 'bounced'],
  ['FilteredSpam', 'bounced'],
  ['Suppressed', 'rejected'],
  ['Quarantined', 'deferred'],
]);

const eventOf = (record) => {
  const data = isRecord(record.data) ? record.data : {};
  let type = 'unknown';
  let at = record.eventTime;
  let url;
  if (record.eventType === DELIVERY) {
    type = DELIVERY_TYPES.get(data.status) ?? 'unknown';
    at = data.deliveryAttemptTimeStamp ?? at;
  } else if (record.eventType === ENGAGEMENT) {
    type = data.engagementType === 'click' ? 'clicked' : 'opened';
    at = data.userActionTimeStamp ?? at;
    if (type === 'clicked') url = stringOf(data.engagementContext);
  }
  const details = isRecord(data.deliveryStatusDetails) ? data.deliveryStatusDetails : {};
  const reason = stringOf(details.statusMessage);
  let bounce;
  if (type === 'bounced') {
    bounce = { kind: 'undetermined' };
    if (reason !== undefined) bounce.diagnostic = reason;
  }
  return createEvent({
    provider: 'azure',
    type,
    id: stringOf(record.id),
    // The id of the send operation, the receipt's.
    messageId: stringOf(data.messageId),
    recipient: stringOf(data.recipient),
    occurredAt: dateOf(at),
    bounce,
    reason: reason ?? stringOf(data.status),
    url,
    raw: record,
  });
};

/**
 * Makes the verifier of the email events of Azure Communication Services,
 * delivered by an Event Grid subscription with the Event Grid schema.  Event
 * Grid signs nothing, so the subscription carries a token as a secret
 * delivery property (`Authorization: Bearer <token>`, or a custom `header`),
 * required on every notification and compared in constant time; each event is
 * taken once by its id.  The validation of a new subscription is handed back,
 * for the application to answer `{ validationResponse: validationCode }`.
 *
 * @param options `token`, `header`; `replayStore`; `leaseMs` and
 * `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events, validation?, commit,
 * release }`.
 * @throws {TypeError} If an option is invalid.
 */
const createAzureWebhookVerifier = (options = {}) => {
  const checkToken = tokenCheckOf(options, 'Event Grid');
  const common = resolveCommonOptions(options, DAY_REPLAY_TTL_MS);
  return {
    async verify(request) {
      const bytes = bodyBytesOf(request, common);
      const kind = headerOf(request, 'aeg-event-type');
      // A validation carries no event, and answering it gives nothing away.
      if (kind === 'SubscriptionValidation') {
        const payload = parseJsonOf(bytes);
        const first = Array.isArray(payload) ? payload[0] : undefined;
        if (!isRecord(first) || first.eventType !== VALIDATION || !isRecord(first.data)) {
          throw new WebhookVerificationError('payload', 'The body is not a validation event.');
        }
        return deliveryOf([], {
          validation: {
            validationCode: first.data.validationCode,
            validationUrl: first.data.validationUrl,
          },
        });
      }
      checkToken(request);
      const payload = parseJsonOf(bytes);
      if (!Array.isArray(payload)) {
        throw new WebhookVerificationError(
          'payload',
          'The body is not a list of Event Grid events.',
        );
      }
      const entries = [];
      for (const record of payload) {
        if (!isRecord(record) || typeof record.id !== 'string') continue;
        entries.push({ key: `azure:${record.id}`, events: [eventOf(record)] });
      }
      return claimDelivery(common, entries, {}, DAY_REPLAY_TTL_MS);
    },
  };
};

module.exports = { createAzureWebhookVerifier };
