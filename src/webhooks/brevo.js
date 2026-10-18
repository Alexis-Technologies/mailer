// Ported from sently v1.2.2 (src/webhooks/brevo.ts): the events of Brevo's
// transactional webhooks, `BREVO_EVENT_MAP` and `parse`.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: Brevo signs nothing, so the token the webhook is
// configured with (its `auth` token, or a custom header) is required and
// compared in constant time, where sently parsed any request; an unsubscribe
// is `unsubscribed`, not a spam complaint; a blocked or invalid address is
// `rejected`, not a bounce; a soft bounce is soft; and the metadata comes
// back from `X-Mailin-custom`, as `./brevo` sends it.

const {
  WebhookVerificationError,
  bodyBytesOf,
  createEvent,
  dateOf,
  deliveryOf,
  isRecord,
  jsonRecordOf,
  observed,
  parseJsonOf,
  resolveCredentialOptions,
  stringOf,
  stringsOf,
  tokenCheckOf,
} = require('./request.js');

const TYPES = new Map([
  ['request', 'accepted'],
  ['sent', 'accepted'],
  ['delivered', 'delivered'],
  ['deferred', 'deferred'],
  ['hard_bounce', 'bounced'],
  ['hardBounce', 'bounced'],
  ['soft_bounce', 'bounced'],
  ['softBounce', 'bounced'],
  ['blocked', 'rejected'],
  ['invalid', 'rejected'],
  ['invalid_email', 'rejected'],
  ['error', 'rejected'],
  ['spam', 'complained'],
  ['complaint', 'complained'],
  ['unsubscribe', 'unsubscribed'],
  ['unsubscribed', 'unsubscribed'],
  ['opened', 'opened'],
  ['unique_opened', 'opened'],
  ['uniqueOpened', 'opened'],
  ['proxy_open', 'opened'],
  ['click', 'clicked'],
  ['unique_click', 'clicked'],
]);
const HARD = new Set(['hard_bounce', 'hardBounce']);

const eventOf = (record) => {
  const type = TYPES.get(record.event) ?? 'unknown';
  const reason = stringOf(record.reason);
  let bounce;
  if (type === 'bounced') {
    bounce = { kind: HARD.has(record.event) ? 'hard' : 'soft' };
    if (reason !== undefined) bounce.diagnostic = reason;
  }
  const messageId = stringOf(record['message-id']) ?? stringOf(record.messageId);
  const recipient = stringOf(record.email);
  const at = record.ts_event ?? record.ts_epoch ?? record.ts ?? record.date;
  const tags = stringsOf(record.tags);
  if (tags.length === 0 && stringOf(record.tag) !== undefined) tags.push(record.tag);
  return createEvent({
    provider: 'brevo',
    type,
    id: `${record.event}:${messageId}:${recipient}:${at}`,
    messageId,
    recipient,
    occurredAt: dateOf(at),
    bounce,
    reason,
    url: stringOf(record.link),
    tags,
    metadata: jsonRecordOf(record['X-Mailin-custom']),
    raw: record,
  });
};

/**
 * Makes the verifier of Brevo's transactional webhooks, which carry the token
 * they are configured with: their `auth` token, as `Authorization: Bearer`,
 * or the value of a custom `header`.
 *
 * @param options `token`, `header` (`authorization`) and `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events, commit, release }`;
 * committing does nothing, as nothing is kept.
 * @throws {TypeError} If an option is invalid.
 */
const createBrevoWebhookVerifier = (options = {}) => {
  const checkToken = tokenCheckOf(options, 'Brevo');
  const common = resolveCredentialOptions(options);
  return {
    verify: observed(common, 'brevo', async (request) => {
      const bytes = bodyBytesOf(request, common);
      checkToken(request);
      const payload = parseJsonOf(bytes);
      const records = Array.isArray(payload) ? payload : [payload];
      const events = [];
      for (const record of records) {
        if (isRecord(record)) events.push(eventOf(record));
      }
      if (events.length === 0) {
        throw new WebhookVerificationError('payload', 'The body is not a Brevo event.');
      }
      return deliveryOf(events);
    }),
  };
};

module.exports = { createBrevoWebhookVerifier };
