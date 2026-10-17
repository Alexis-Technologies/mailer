// Not ported: the events of Mailjet's Event API, whose URL carries Basic
// credentials (https://dev.mailjet.com/email/guides/webhooks/).  sently and
// unemail have no Mailjet webhook.

const {
  WebhookVerificationError,
  basicCredentialsOf,
  bodyBytesOf,
  checkBasicCredentials,
  createEvent,
  dateOf,
  deliveryOf,
  isRecord,
  jsonRecordOf,
  parseJsonOf,
  resolveCredentialOptions,
  stringOf,
} = require('./request.js');

const TYPES = new Map([
  ['sent', 'delivered'],
  ['bounce', 'bounced'],
  ['blocked', 'rejected'],
  ['spam', 'complained'],
  ['unsub', 'unsubscribed'],
  ['open', 'opened'],
  ['click', 'clicked'],
]);

const eventOf = (record) => {
  const type = TYPES.get(record.event) ?? 'unknown';
  let bounce;
  if (type === 'bounced') {
    bounce = { kind: record.hard_bounce === true ? 'hard' : 'soft' };
    if (stringOf(record.error) !== undefined) bounce.diagnostic = record.error;
  }
  // The MessageUUID of the send's answer, the receipt's id.
  const messageId =
    stringOf(record.Message_GUID) ??
    (record.MessageID === undefined ? undefined : String(record.MessageID));
  const recipient = stringOf(record.email);
  const customCampaign = stringOf(record.customcampaign);
  return createEvent({
    provider: 'mailjet',
    type,
    id: `${record.event}:${messageId}:${recipient}:${record.time}`,
    messageId,
    recipient,
    occurredAt: dateOf(record.time),
    bounce,
    reason: stringOf(record.error) ?? stringOf(record.source),
    url: stringOf(record.url),
    tags: customCampaign === undefined ? [] : [customCampaign],
    metadata: jsonRecordOf(record.Payload),
    raw: record,
  });
};

/**
 * Makes the verifier of Mailjet's Event API, whose callback URL carries Basic
 * credentials (`https://user:password@…`), as Mailjet signs nothing.  The
 * message id is the MessageUUID of the receipt; the custom campaign is the
 * tag, the event payload the metadata, as `./mailjet` sends them.
 *
 * @param options `username`, `password` and `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events, commit, release }`;
 * committing does nothing, as nothing is kept.
 * @throws {TypeError} If a credential is missing.
 */
const createMailjetWebhookVerifier = (options = {}) => {
  const expected = basicCredentialsOf(options, 'Mailjet');
  const common = resolveCredentialOptions(options);
  return {
    async verify(request) {
      const bytes = bodyBytesOf(request, common);
      checkBasicCredentials(request, expected);
      const payload = parseJsonOf(bytes);
      const records = Array.isArray(payload) ? payload : [payload];
      const events = [];
      for (const record of records) {
        if (isRecord(record)) events.push(eventOf(record));
      }
      if (events.length === 0) {
        throw new WebhookVerificationError('payload', 'The body is not a Mailjet event.');
      }
      return deliveryOf(events);
    },
  };
};

module.exports = { createMailjetWebhookVerifier };
