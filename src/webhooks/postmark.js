// Ported from sently v1.2.2 (src/webhooks/postmark.ts): the events of
// Postmark's webhooks, `POSTMARK_EVENT_MAP` and `parse`.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: Postmark signs nothing, so the credentials of the
// webhook's URL (Basic authentication) are required and compared in constant
// time, where sently parsed any request; a bounce is read by its type — a
// hard or a soft bounce, a deferral, a complaint, an unsubscribe or a
// rejection — where sently made every one `bounced`; and an unsubscribe of a
// subscription change is `unsubscribed`.

const {
  WebhookVerificationError,
  basicCredentialsOf,
  bodyBytesOf,
  checkBasicCredentials,
  createEvent,
  dateOf,
  isRecord,
  parseJsonOf,
  resolveCommonOptions,
  stringOf,
  stringRecordOf,
} = require('./request.js');

// What a bounce of Postmark is, by its Type.
const BOUNCES = new Map([
  ['HardBounce', { type: 'bounced', kind: 'hard' }],
  ['BadEmailAddress', { type: 'bounced', kind: 'hard' }],
  ['DMARCPolicy', { type: 'bounced', kind: 'hard' }],
  ['SoftBounce', { type: 'bounced', kind: 'soft' }],
  ['DnsError', { type: 'bounced', kind: 'soft' }],
  ['Blocked', { type: 'bounced', kind: 'soft' }],
  ['Transient', { type: 'deferred', kind: 'soft' }],
  ['SpamComplaint', { type: 'complained' }],
  ['SpamNotification', { type: 'complained' }],
  ['Unsubscribe', { type: 'unsubscribed' }],
  ['ManuallyDeactivated', { type: 'rejected' }],
  ['SMTPApiError', { type: 'rejected' }],
  ['TemplateRenderingFailed', { type: 'rejected' }],
  ['AutoResponder', { type: 'unknown' }],
  ['AddressChange', { type: 'unknown' }],
  ['Subscribe', { type: 'unknown' }],
  ['ChallengeVerification', { type: 'unknown' }],
  ['InboundError', { type: 'unknown' }],
]);
const TYPES = new Map([
  ['Delivery', 'delivered'],
  ['SpamComplaint', 'complained'],
  ['Open', 'opened'],
  ['Click', 'clicked'],
]);

const describeRecord = (record) => {
  if (record.RecordType === 'Bounce') {
    const known = BOUNCES.get(record.Type) ?? { type: 'bounced', kind: 'undetermined' };
    let bounce;
    if (known.kind !== undefined) {
      bounce = { kind: known.kind };
      if (record.TypeCode !== undefined) bounce.code = String(record.TypeCode);
      const diagnostic = stringOf(record.Details) ?? stringOf(record.Description);
      if (diagnostic !== undefined) bounce.diagnostic = diagnostic;
    }
    return { type: known.type, bounce, reason: stringOf(record.Type), at: record.BouncedAt };
  }
  if (record.RecordType === 'SubscriptionChange') {
    return {
      type: record.SuppressSending === true ? 'unsubscribed' : 'unknown',
      reason: stringOf(record.SuppressionReason),
      at: record.ChangedAt,
    };
  }
  return {
    type: TYPES.get(record.RecordType) ?? 'unknown',
    at: record.DeliveredAt ?? record.ReceivedAt ?? record.BouncedAt,
  };
};

const eventOf = (record) => {
  const described = describeRecord(record);
  const recipient = stringOf(record.Recipient) ?? stringOf(record.Email);
  const messageId = stringOf(record.MessageID);
  const occurredAt = dateOf(described.at);
  const id =
    record.ID === undefined
      ? `${record.RecordType}:${messageId}:${recipient}:${occurredAt?.toISOString()}`
      : `${record.RecordType}:${record.ID}`;
  const tag = stringOf(record.Tag);
  return createEvent({
    provider: 'postmark',
    type: described.type,
    id,
    messageId,
    recipient,
    occurredAt,
    bounce: described.bounce,
    reason: described.reason,
    url: stringOf(record.OriginalLink),
    tags: tag === undefined ? [] : [tag],
    metadata: stringRecordOf(record.Metadata),
    raw: record,
  });
};

/**
 * Makes the verifier of Postmark's webhooks, whose URL carries credentials
 * (`https://user:password@…`), as Postmark signs nothing.
 *
 * @param options `username` and `password` of the webhook's URL, and
 * `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events }`.
 * @throws {TypeError} If an option is invalid.
 */
const createPostmarkWebhookVerifier = (options = {}) => {
  const expected = basicCredentialsOf(options, 'Postmark');
  // No time or id to hold a request to: the credentials alone stand for it.
  const common = resolveCommonOptions({ ...options, replayStore: null }, 5 * 60 * 1000);
  return {
    async verify(request) {
      const bytes = bodyBytesOf(request, common);
      checkBasicCredentials(request, expected);
      const record = parseJsonOf(bytes);
      if (!isRecord(record) || typeof record.RecordType !== 'string') {
        throw new WebhookVerificationError('payload', 'The body is not a Postmark event.');
      }
      return { events: [eventOf(record)] };
    },
  };
};

module.exports = { createPostmarkWebhookVerifier };
