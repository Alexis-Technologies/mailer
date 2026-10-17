// Not ported: the events of Maileroo's webhooks, signed with an HMAC of the
// raw body (https://maileroo.com/docs/api-reference/emails/webhooks).
// sently and unemail have no Maileroo webhook.

const {
  WebhookVerificationError,
  bodyBytesOf,
  checkBodyHmac,
  checkReplay,
  createEvent,
  dateOf,
  isRecord,
  parseJsonOf,
  resolveCommonOptions,
  splitNamedTags,
  stringOf,
} = require('./request.js');

// Maileroo signs no time: an event id is kept a day and an hour.
const REPLAY_TTL_MS = 25 * 60 * 60 * 1000;
const TYPES = new Map([
  ['accepted', 'accepted'],
  ['delivered', 'delivered'],
  ['deferred', 'deferred'],
  ['failed', 'bounced'],
  ['rejected', 'rejected'],
  ['complained', 'complained'],
  ['opened', 'opened'],
  ['clicked', 'clicked'],
]);

const recipientsOf = (to) => {
  if (typeof to === 'string') return [to];
  const recipients = [];
  if (!Array.isArray(to)) return recipients;
  for (const address of to) {
    if (typeof address === 'string') recipients.push(address);
  }
  return recipients;
};

const eventsOf = (payload) => {
  const data = isRecord(payload.event_data) ? payload.event_data : {};
  const type = TYPES.get(payload.event_type) ?? 'unknown';
  const reason = stringOf(data.reason) ?? stringOf(data.reject_reason);
  let bounce;
  if (type === 'bounced' || type === 'deferred') {
    bounce = { kind: type === 'bounced' ? 'hard' : 'soft' };
    if (reason !== undefined) bounce.diagnostic = reason;
  }
  const { tags, metadata } = splitNamedTags(payload.tags);
  const recipients = recipientsOf(data.to);
  const list = recipients.length > 0 ? recipients : [undefined];
  const events = [];
  for (let index = 0; index < list.length; index++) {
    events.push(
      createEvent({
        provider: 'maileroo',
        type,
        id: `${payload.event_id}:${index}`,
        // The reference of the message is the receipt's id.
        messageId: stringOf(payload.message_reference_id),
        recipient: list[index],
        occurredAt: dateOf(payload.event_time),
        bounce,
        reason,
        url: stringOf(data.original_url),
        tags,
        metadata,
        raw: payload,
      }),
    );
  }
  return events;
};

/**
 * Makes the verifier of Maileroo's webhooks: the HMAC-SHA256 of the body, in
 * hexadecimal in `x-maileroo-signature`.  Maileroo signs no time, so an event
 * is taken once by its id, kept a day and an hour.
 *
 * @param options `secret`; `replayStore` and `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events }`.
 * @throws {TypeError} If the secret is missing.
 */
const createMailerooWebhookVerifier = (options = {}) => {
  if (typeof options.secret !== 'string' || options.secret === '') {
    throw new TypeError('secret is the signing secret of the Maileroo webhook.');
  }
  const secret = options.secret;
  const common = resolveCommonOptions(options, REPLAY_TTL_MS);
  return {
    async verify(request) {
      const bytes = bodyBytesOf(request, common);
      checkBodyHmac(request, bytes, 'x-maileroo-signature', secret, 'Maileroo');
      const payload = parseJsonOf(bytes);
      if (!isRecord(payload) || typeof payload.event_id !== 'string') {
        throw new WebhookVerificationError('payload', 'The body is not a Maileroo event.');
      }
      await checkReplay(common, `maileroo:${payload.event_id}`, REPLAY_TTL_MS);
      return { events: eventsOf(payload) };
    },
  };
};

module.exports = { createMailerooWebhookVerifier };
