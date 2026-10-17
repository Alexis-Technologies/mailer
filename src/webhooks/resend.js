// Ported from sently v1.2.2 (src/webhooks/resend.ts): the events of Resend,
// signed by Svix, `RESEND_EVENT_MAP`, `parse` and `verifySignature`.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: the signature is checked before the payload is read,
// over its raw bytes, with the time of the request held to a window and its
// id taken once, where sently exported `parse` apart and took any time and
// any number of replays; a secret that is not base64 is refused when the
// verifier is made, where sently's `atob` threw at each request; an event of
// several recipients is one per recipient; a bounce says whether it is hard
// or soft; and a failed or suppressed email is `rejected`, not `bounced` or
// `unknown`.

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
  splitNamedTags,
  stringOf,
} = require('./request.js');

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const TYPES = new Map([
  ['email.sent', 'accepted'],
  ['email.scheduled', 'accepted'],
  ['email.delivered', 'delivered'],
  ['email.delivery_delayed', 'deferred'],
  ['email.bounced', 'bounced'],
  ['email.failed', 'rejected'],
  ['email.suppressed', 'rejected'],
  ['email.complained', 'complained'],
  ['email.opened', 'opened'],
  ['email.clicked', 'clicked'],
]);
const BOUNCE_KINDS = new Map([
  ['Permanent', 'hard'],
  ['Transient', 'soft'],
]);

/**
 * The key of a Svix secret, `whsec_` and base64.
 *
 * @internal
 */
const svixKeyOf = (secret, name) => {
  if (typeof secret !== 'string') throw new TypeError(`${name} is the signing secret, whsec_….`);
  const encoded = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  if (encoded.length === 0 || encoded.length % 4 !== 0 || !BASE64.test(encoded)) {
    throw new TypeError(`${name} must be the signing secret, whsec_ and base64.`);
  }
  return Buffer.from(encoded, 'base64');
};

/**
 * Checks the Svix signature of a request: the HMAC-SHA256 of
 * `id.timestamp.body` against one of the `v1,` signatures of its header.
 *
 * @returns The id of the message.
 * @internal
 */
const checkSvixSignature = (request, bytes, key, common) => {
  const id = headerOf(request, 'svix-id') ?? headerOf(request, 'webhook-id');
  const timestamp = headerOf(request, 'svix-timestamp') ?? headerOf(request, 'webhook-timestamp');
  const header = headerOf(request, 'svix-signature') ?? headerOf(request, 'webhook-signature');
  if (id === undefined || timestamp === undefined || header === undefined) {
    throw new WebhookVerificationError('signature', 'The request has no Svix signature.');
  }
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.`, 'utf8')
    .update(bytes)
    .digest();
  let matched = false;
  for (const part of header.split(' ')) {
    if (!part.startsWith('v1,')) continue;
    if (equalBytes(expected, Buffer.from(part.slice(3), 'base64'))) matched = true;
  }
  if (!matched) {
    throw new WebhookVerificationError('signature', 'The Svix signature does not match.');
  }
  if (!/^\d+$/.test(timestamp)) {
    throw new WebhookVerificationError('timestamp', 'The Svix timestamp is not a number.');
  }
  checkTime(Number(timestamp) * 1000, common);
  return id;
};

const recipientsOf = (to) => {
  if (typeof to === 'string') return [to];
  const recipients = [];
  if (!Array.isArray(to)) return recipients;
  for (const address of to) {
    if (typeof address === 'string') recipients.push(address);
  }
  return recipients;
};

const eventsOf = (payload, id) => {
  const data = isRecord(payload.data) ? payload.data : {};
  const type = TYPES.get(payload.type) ?? 'unknown';
  const { tags, metadata } = splitNamedTags(data.tags);
  let bounce;
  if (type === 'bounced' && isRecord(data.bounce)) {
    bounce = { kind: BOUNCE_KINDS.get(data.bounce.type) ?? 'undetermined' };
    if (stringOf(data.bounce.message) !== undefined) bounce.diagnostic = data.bounce.message;
  }
  const detail = data.bounce ?? data.failed ?? data.suppressed ?? data.delivery_delayed;
  const reason = isRecord(detail)
    ? (stringOf(detail.subType) ?? stringOf(detail.reason) ?? stringOf(detail.message))
    : undefined;
  const recipients = recipientsOf(data.to);
  const list = recipients.length > 0 ? recipients : [undefined];
  const events = [];
  for (let index = 0; index < list.length; index++) {
    events.push(
      createEvent({
        provider: 'resend',
        type,
        id: `${id}:${index}`,
        messageId: stringOf(data.email_id),
        recipient: list[index],
        occurredAt: dateOf(payload.created_at ?? data.created_at),
        bounce,
        reason,
        url: isRecord(data.click) ? stringOf(data.click.link) : undefined,
        tags,
        metadata,
        raw: payload,
      }),
    );
  }
  return events;
};

/**
 * Makes the verifier of the webhooks of Resend, which Svix signs.
 *
 * @param options `secret`, the signing secret of the webhook (`whsec_…`);
 * `now`, `toleranceMs` (five minutes), `replayStore` and `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events }`.
 * @throws {TypeError} If an option is invalid.
 */
const createResendWebhookVerifier = (options = {}) => {
  const key = svixKeyOf(options.secret, 'secret');
  const common = resolveCommonOptions(options, DEFAULT_TOLERANCE_MS);
  return {
    async verify(request) {
      const bytes = bodyBytesOf(request, common);
      const id = checkSvixSignature(request, bytes, key, common);
      await checkReplay(common, `resend:${id}`);
      const payload = parseJsonOf(bytes);
      if (!isRecord(payload)) {
        throw new WebhookVerificationError('payload', 'The body is not a Resend event.');
      }
      return { events: eventsOf(payload, id) };
    },
  };
};

module.exports = { checkSvixSignature, createResendWebhookVerifier, svixKeyOf };
