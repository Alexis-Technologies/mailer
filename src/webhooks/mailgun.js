// Ported from sently v1.2.2 (src/webhooks/mailgun.ts): the events of
// Mailgun's webhooks, `MAILGUN_EVENT_MAP`, `parse` and `verifyPayload`.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: the signature is checked with the time of the request
// held to a window and its token taken once, where sently took any time and
// any number of replays and exported `parse` apart; a message Mailgun dropped
// for a suppression or rejected is `rejected`, not a bounce; an unsubscribe is
// `unsubscribed`; a temporary failure is a deferred soft bounce; and the
// message id is that of the receipt, in angle brackets.

const { createHmac } = require('node:crypto');
const {
  WebhookVerificationError,
  bodyBytesOf,
  checkReplay,
  checkTime,
  createEvent,
  dateOf,
  equalBytes,
  isRecord,
  parseJsonOf,
  resolveCommonOptions,
  stringOf,
  stringRecordOf,
  stringsOf,
} = require('./request.js');

const DEFAULT_TOLERANCE_MS = 5 * 60 * 1000;
const TYPES = new Map([
  ['accepted', 'accepted'],
  ['delivered', 'delivered'],
  ['rejected', 'rejected'],
  ['complained', 'complained'],
  ['unsubscribed', 'unsubscribed'],
  ['opened', 'opened'],
  ['clicked', 'clicked'],
]);
const HEX = /^[0-9a-f]+$/i;

// What a failure is: a suppression or a rejection Mailgun made before any
// attempt, a temporary failure it retries, or a bounce.
const failureOf = (data) => {
  const status = isRecord(data['delivery-status']) ? data['delivery-status'] : {};
  const reason = stringOf(data.reason);
  if (reason?.startsWith('suppress-')) return { type: 'rejected', reason };
  const bounce = { kind: data.severity === 'temporary' ? 'soft' : 'hard' };
  if (status.code !== undefined && status.code !== null) bounce.code = String(status.code);
  const diagnostic = stringOf(status.description) ?? stringOf(status.message);
  if (diagnostic !== undefined) bounce.diagnostic = diagnostic;
  return { type: data.severity === 'temporary' ? 'deferred' : 'bounced', bounce, reason };
};

const messageIdOf = (message) => {
  const id = isRecord(message?.headers) ? stringOf(message.headers['message-id']) : undefined;
  if (id === undefined) return undefined;
  return id.startsWith('<') ? id : `<${id}>`;
};

const eventOf = (data, token) => {
  const failure = data.event === 'failed' ? failureOf(data) : undefined;
  return createEvent({
    provider: 'mailgun',
    type: failure?.type ?? TYPES.get(data.event) ?? 'unknown',
    id: stringOf(data.id) ?? token,
    messageId: messageIdOf(data.message),
    recipient: stringOf(data.recipient),
    occurredAt: dateOf(data.timestamp),
    bounce: failure?.bounce,
    reason: failure?.reason ?? (isRecord(data.reject) ? stringOf(data.reject.reason) : undefined),
    url: stringOf(data.url),
    tags: stringsOf(data.tags),
    metadata: stringRecordOf(data['user-variables']),
    raw: data,
  });
};

/**
 * Makes the verifier of Mailgun's webhooks.
 *
 * @param options `signingKey`, the HTTP webhook signing key of the domain;
 * `now`, `toleranceMs` (five minutes), `replayStore` and `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events }`.
 * @throws {TypeError} If an option is invalid.
 */
const createMailgunWebhookVerifier = (options = {}) => {
  if (typeof options.signingKey !== 'string' || options.signingKey === '') {
    throw new TypeError('signingKey is the HTTP webhook signing key of Mailgun.');
  }
  const signingKey = options.signingKey;
  const common = resolveCommonOptions(options, DEFAULT_TOLERANCE_MS);
  return {
    async verify(request) {
      // The signature is a field of the body, read to find it and trusted
      // only once it matches.
      const payload = parseJsonOf(bodyBytesOf(request, common));
      const signature = isRecord(payload) ? payload.signature : undefined;
      const timestamp = stringOf(signature?.timestamp);
      const token = stringOf(signature?.token);
      const given = stringOf(signature?.signature);
      if (
        timestamp === undefined ||
        token === undefined ||
        given === undefined ||
        !HEX.test(given)
      ) {
        throw new WebhookVerificationError('signature', 'The request has no Mailgun signature.');
      }
      const expected = createHmac('sha256', signingKey)
        .update(timestamp + token)
        .digest();
      if (!equalBytes(expected, Buffer.from(given, 'hex'))) {
        throw new WebhookVerificationError('signature', 'The Mailgun signature does not match.');
      }
      checkTime(Number(timestamp) * 1000, common);
      await checkReplay(common, `mailgun:${token}`);
      const data = payload['event-data'];
      if (!isRecord(data)) {
        throw new WebhookVerificationError('payload', 'The body has no Mailgun event.');
      }
      return { events: [eventOf(data, token)] };
    },
  };
};

module.exports = { createMailgunWebhookVerifier };
