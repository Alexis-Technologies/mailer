// Not ported: the events of MailerSend's webhooks, signed with an HMAC of
// the raw body (https://developers.mailersend.com/api/v1/webhooks.html).
// sently and unemail have no MailerSend webhook.

const {
  DAY_REPLAY_TTL_MS,
  WebhookVerificationError,
  bodyBytesOf,
  checkBodyHmac,
  claimDelivery,
  createEvent,
  dateOf,
  headerValueOf,
  isRecord,
  metadataFromHeaders,
  observed,
  parseJsonOf,
  requireSecret,
  resolveUntimedOptions,
  stringOf,
  stringsOf,
} = require('./request.js');

// MailerSend signs no time: an event id is kept a day and an hour, past the
// retries of a delivery.
const TYPES = new Map([
  ['activity.sent', 'accepted'],
  ['activity.delivered', 'delivered'],
  ['activity.deferred', 'deferred'],
  ['activity.soft_bounced', 'bounced'],
  ['activity.hard_bounced', 'bounced'],
  ['activity.suppressed', 'rejected'],
  ['activity.spam_complaint', 'complained'],
  ['activity.unsubscribed', 'unsubscribed'],
  ['activity.opened', 'opened'],
  ['activity.opened_unique', 'opened'],
  ['activity.clicked', 'clicked'],
  ['activity.clicked_unique', 'clicked'],
]);
// MailerSend has written its activity both flat (`data.recipient`) and nested
// (`data.email.recipient.email`); both are read.
const eventOf = (payload) => {
  const data = isRecord(payload.data) ? payload.data : {};
  const email = isRecord(data.email) ? data.email : {};
  let meta = {};
  if (isRecord(data.meta)) meta = data.meta;
  else if (isRecord(data.morph)) meta = data.morph;
  const type = TYPES.get(payload.type) ?? 'unknown';
  let bounce;
  if (type === 'bounced') {
    bounce = { kind: payload.type === 'activity.hard_bounced' ? 'hard' : 'soft' };
    if (meta.bounce_code !== undefined && meta.bounce_code !== null) {
      bounce.code = String(meta.bounce_code);
    }
    const diagnostic = stringOf(meta.bounce_reason) ?? stringOf(meta.reason);
    if (diagnostic !== undefined) bounce.diagnostic = diagnostic;
  }
  const recipient =
    stringOf(data.recipient) ??
    (isRecord(email.recipient) ? stringOf(email.recipient.email) : undefined);
  const messageId =
    stringOf(data.message_id) ?? (isRecord(email.message) ? stringOf(email.message.id) : undefined);
  return createEvent({
    provider: 'mailersend',
    type,
    id: `${stringOf(data.id) ?? stringOf(payload.created_at)}:${payload.type}`,
    messageId,
    rfcMessageId: headerValueOf(email.headers ?? data.headers, 'message-id'),
    recipient,
    occurredAt: dateOf(data.created_at ?? payload.created_at),
    bounce,
    reason: stringOf(meta.reason) ?? stringOf(meta.bounce_reason),
    url: stringOf(meta.url),
    tags: stringsOf(data.tags ?? email.tags),
    metadata: metadataFromHeaders(email.headers ?? data.headers),
    raw: payload,
  });
};

/**
 * Makes the verifier of MailerSend's webhooks: the HMAC-SHA256 of the body,
 * in hexadecimal in `Signature`, with the signing secret of the webhook.
 * MailerSend signs no time, so an event is taken once by its id, kept a day
 * and an hour.
 *
 * @param options `secret`; `replayStore`; `leaseMs` and `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events, commit, release }`.
 * @throws {TypeError} If an option is invalid.
 */
const createMailerSendWebhookVerifier = (options = {}) => {
  const secret = requireSecret(
    options.secret,
    'secret is the signing secret of the MailerSend webhook.',
  );
  const common = resolveUntimedOptions(options);
  return {
    verify: observed(common, 'mailersend', async (request) => {
      const bytes = bodyBytesOf(request, common);
      checkBodyHmac(request, bytes, 'signature', secret, 'MailerSend');
      const payload = parseJsonOf(bytes);
      if (!isRecord(payload) || typeof payload.type !== 'string') {
        throw new WebhookVerificationError('payload', 'The body is not a MailerSend event.');
      }
      const event = eventOf(payload);
      const entries = [{ key: `mailersend:${event.id}`, events: [event] }];
      return claimDelivery(common, entries, {}, DAY_REPLAY_TTL_MS);
    }),
  };
};

module.exports = { createMailerSendWebhookVerifier };
