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

const {
  DEFAULT_TOLERANCE_MS,
  WebhookVerificationError,
  bodyBytesOf,
  bounceKindOf,
  checkSignedSeconds,
  claimDelivery,
  createEvent,
  dateOf,
  equalBytes,
  headerOf,
  hmacOf,
  isRecord,
  observed,
  parseJsonOf,
  resolveCommonOptions,
  splitNamedTags,
  stringListOf,
  stringOf,
} = require('./request.js');

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
  const expected = hmacOf(key, [`${id}.${timestamp}.`, bytes]);
  let matched = false;
  for (const part of header.split(' ')) {
    if (!part.startsWith('v1,')) continue;
    if (equalBytes(expected, Buffer.from(part.slice(3), 'base64'))) matched = true;
  }
  if (!matched) {
    throw new WebhookVerificationError('signature', 'The Svix signature does not match.');
  }
  checkSignedSeconds(timestamp, common, 'Svix');
  return id;
};

const eventsOf = (payload, id) => {
  const data = isRecord(payload.data) ? payload.data : {};
  const type = TYPES.get(payload.type) ?? 'unknown';
  const { tags, metadata } = splitNamedTags(data.tags);
  let bounce;
  if (type === 'bounced' && isRecord(data.bounce)) {
    bounce = { kind: bounceKindOf(data.bounce.type) };
    if (stringOf(data.bounce.message) !== undefined) bounce.diagnostic = data.bounce.message;
  }
  const detail = data.bounce ?? data.failed ?? data.suppressed ?? data.delivery_delayed;
  const reason = isRecord(detail)
    ? (stringOf(detail.subType) ?? stringOf(detail.reason) ?? stringOf(detail.message))
    : undefined;
  const recipients = stringListOf(data.to);
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
 * `replayStore`; `now`, `toleranceMs` (five minutes), `leaseMs` and
 * `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events, commit, release }`.
 * @throws {TypeError} If an option is invalid.
 */
const createResendWebhookVerifier = (options = {}) => {
  const key = svixKeyOf(options.secret, 'secret');
  const common = resolveCommonOptions(options, DEFAULT_TOLERANCE_MS);
  return {
    verify: observed(common, 'resend', async (request) => {
      const bytes = bodyBytesOf(request, common);
      const id = checkSvixSignature(request, bytes, key, common);
      const payload = parseJsonOf(bytes);
      if (!isRecord(payload)) {
        throw new WebhookVerificationError('payload', 'The body is not a Resend event.');
      }
      return claimDelivery(common, [{ key: `resend:${id}`, events: eventsOf(payload, id) }]);
    }),
  };
};

module.exports = { checkSvixSignature, createResendWebhookVerifier, svixKeyOf };
