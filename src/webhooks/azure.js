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
  observed,
  parseJsonOf,
  resolveCommonOptions,
  stringOf,
  tokenCheckOf,
} = require('./request.js');

// Event Grid retries a delivery for a day: an event id is kept a day and an
// hour.
const VALIDATION = 'Microsoft.EventGrid.SubscriptionValidationEvent';
// Where Event Grid has a subscription validated by hand: an application that
// fetches the URL of a validation must not be sent anywhere else by it.
const EVENT_GRID_HOST = /^[a-z0-9-]+\.eventgrid\.azure\.net$/i;
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
const isEventGridUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && EVENT_GRID_HOST.test(url.hostname) && url.username === '';
};

const validationOf = (payload) => {
  const first = Array.isArray(payload) ? payload[0] : undefined;
  const data = isRecord(first) ? first.data : undefined;
  if (
    first?.eventType !== VALIDATION ||
    !isRecord(data) ||
    stringOf(data.validationCode) === undefined
  ) {
    throw new WebhookVerificationError('payload', 'The body is not a validation event.');
  }
  if (data.validationUrl !== undefined && !isEventGridUrl(data.validationUrl)) {
    throw new WebhookVerificationError('payload', 'The validation URL is not of Event Grid.');
  }
  return { validationCode: data.validationCode, validationUrl: data.validationUrl };
};

const createAzureWebhookVerifier = (options = {}) => {
  const checkToken = tokenCheckOf(options, 'Event Grid');
  const tokenHeader = options.header ?? 'authorization';
  const common = resolveCommonOptions(options, DAY_REPLAY_TTL_MS);
  return {
    verify: observed(common, 'azure', async (request) => {
      const bytes = bodyBytesOf(request, common);
      const kind = headerOf(request, 'aeg-event-type');
      // A validation carries no event, and answering it gives nothing away;
      // the token is checked when it comes with it.
      if (kind === 'SubscriptionValidation') {
        if (headerOf(request, tokenHeader) !== undefined) checkToken(request);
        return deliveryOf([], { validation: validationOf(parseJsonOf(bytes)) });
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
    }),
  };
};

module.exports = { createAzureWebhookVerifier };
