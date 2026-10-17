// Not ported: the events of Lettermint's webhooks, signed with an HMAC of
// their time and raw body (https://lettermint.co/docs/platform/webhooks/signing).
// sently and unemail have no Lettermint webhook.

const { createHmac } = require('node:crypto');
const {
  WebhookVerificationError,
  bodyBytesOf,
  checkReplay,
  checkTime,
  createEvent,
  dateOf,
  equalBytes,
  headerOf,
  isRecord,
  parseJsonOf,
  resolveCommonOptions,
  stringOf,
  stringRecordOf,
  stringsOf,
} = require('./request.js');

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;
const TYPES = new Map([
  ['message.created', 'accepted'],
  ['message.sent', 'accepted'],
  ['message.delivered', 'delivered'],
  ['message.hard_bounced', 'bounced'],
  ['message.soft_bounced', 'bounced'],
  ['message.spam_complaint', 'complained'],
  ['message.failed', 'rejected'],
  ['message.suppressed', 'rejected'],
  ['message.policy_rejected', 'rejected'],
  ['message.unsubscribed', 'unsubscribed'],
  ['message.opened', 'opened'],
  ['message.clicked', 'clicked'],
]);
const SIGNATURE = /^t=(\d+),v1=([0-9a-f]+)$/i;

// `t=<seconds>,v1=<hex>`: the HMAC-SHA256 of `<seconds>.<body>`, with the
// secret as it is given, `whsec_` and all.
const checkSignature = (request, bytes, secret, common) => {
  const match = SIGNATURE.exec(headerOf(request, 'x-lettermint-signature')?.trim() ?? '');
  if (match === null) {
    throw new WebhookVerificationError('signature', 'The request has no Lettermint signature.');
  }
  const expected = createHmac('sha256', secret).update(`${match[1]}.`).update(bytes).digest();
  if (!equalBytes(expected, Buffer.from(match[2], 'hex'))) {
    throw new WebhookVerificationError('signature', 'The Lettermint signature does not match.');
  }
  checkTime(Number(match[1]) * 1000, common);
};

const bounceOf = (event, data) => {
  const bounce = { kind: event === 'message.hard_bounced' ? 'hard' : 'soft' };
  const response = isRecord(data.response) ? data.response : {};
  const code = stringOf(response.enhanced_status_code) ?? response.status_code;
  if (code !== undefined && code !== null) bounce.code = String(code);
  if (stringOf(response.content) !== undefined) bounce.diagnostic = response.content;
  return bounce;
};

const eventOf = (payload) => {
  const data = isRecord(payload.data) ? payload.data : {};
  const type = TYPES.get(payload.event) ?? 'unknown';
  const tags = stringsOf(data.tags);
  if (tags.length === 0 && stringOf(data.tag) !== undefined) tags.push(data.tag);
  return createEvent({
    provider: 'lettermint',
    type,
    id: stringOf(payload.id),
    messageId: stringOf(data.message_id),
    recipient: stringOf(data.recipient),
    occurredAt: dateOf(payload.timestamp),
    bounce: type === 'bounced' ? bounceOf(payload.event, data) : undefined,
    reason: stringOf(data.reason_code) ?? stringOf(data.reason),
    url: stringOf(data.destination_url),
    tags,
    metadata: stringRecordOf(data.metadata),
    raw: payload,
  });
};

/**
 * Makes the verifier of Lettermint's webhooks: the HMAC-SHA256 of the time
 * and body in `X-Lettermint-Signature` (`t=…,v1=…`), with the signing secret
 * as it is given, within five minutes, its delivery id taken once.
 *
 * @param options `secret`; `now`, `toleranceMs`, `replayStore` and
 * `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events }`.
 * @throws {TypeError} If an option is invalid.
 */
const createLettermintWebhookVerifier = (options = {}) => {
  if (typeof options.secret !== 'string' || options.secret === '') {
    throw new TypeError('secret is the signing secret of the Lettermint webhook.');
  }
  const secret = options.secret;
  const common = resolveCommonOptions(options, DEFAULT_TOLERANCE_MS);
  return {
    async verify(request) {
      const bytes = bodyBytesOf(request, common);
      checkSignature(request, bytes, secret, common);
      const payload = parseJsonOf(bytes);
      if (!isRecord(payload) || typeof payload.id !== 'string') {
        throw new WebhookVerificationError('payload', 'The body is not a Lettermint event.');
      }
      await checkReplay(common, `lettermint:${payload.id}`);
      return { events: [eventOf(payload)] };
    },
  };
};

module.exports = { createLettermintWebhookVerifier };
