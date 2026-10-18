// Ported from sently v1.2.2 (src/webhooks/sendgrid.ts): the events of
// SendGrid's Event Webhook, `SENDGRID_EVENT_MAP` and `parse`.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: the signature of the Signed Event Webhook (ECDSA P-256
// over the timestamp and the raw body) is checked, its time held to a window
// and each event id taken once, where sently parsed the payload unverified;
// an unsubscribe is `unsubscribed`, not a spam complaint; a dropped message is
// `rejected`, not a bounce; a block is a soft bounce, not a deferral; and the
// custom arguments come back as the metadata of the event.

const { createPublicKey, verify: verifySignature } = require('node:crypto');
const {
  DEFAULT_TOLERANCE_MS,
  WebhookVerificationError,
  bodyBytesOf,
  checkSignedSeconds,
  claimDelivery,
  createEvent,
  dateOf,
  headerOf,
  isRecord,
  observed,
  parseJsonOf,
  resolveCommonOptions,
  stringListOf,
  stringOf,
} = require('./request.js');

const SIGNATURE = 'x-twilio-email-event-webhook-signature';
const TIMESTAMP = 'x-twilio-email-event-webhook-timestamp';
const TYPES = new Map([
  ['processed', 'accepted'],
  ['delivered', 'delivered'],
  ['deferred', 'deferred'],
  ['bounce', 'bounced'],
  ['dropped', 'rejected'],
  ['spamreport', 'complained'],
  ['unsubscribe', 'unsubscribed'],
  ['group_unsubscribe', 'unsubscribed'],
  ['open', 'opened'],
  ['click', 'clicked'],
]);
// The fields SendGrid writes into an event; the others are custom arguments.
const OWN_FIELDS = new Set([
  'email',
  'timestamp',
  'event',
  'sg_event_id',
  'sg_message_id',
  'smtp-id',
  'category',
  'reason',
  'status',
  'response',
  'attempt',
  'type',
  'bounce_classification',
  'url',
  'url_offset',
  'useragent',
  'ip',
  'tls',
  'cert_err',
  'asm_group_id',
  'sg_machine_open',
  'sg_content_type',
  'sg_template_id',
  'sg_template_name',
  'marketing_campaign_id',
  'marketing_campaign_name',
  'marketing_campaign_version',
  'marketing_campaign_split_id',
  'mc_stats',
  'post_type',
  'pool',
  'send_at',
  'singlesend_id',
  'singlesend_name',
  'template_id',
  'template_version_id',
  'phase_id',
  'newsletter',
]);

const publicKeyOf = (value) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('publicKey is the verification key of the Signed Event Webhook.');
  }
  try {
    return value.includes('-----BEGIN')
      ? createPublicKey(value)
      : createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' });
  } catch (error) {
    throw new TypeError('publicKey is not a public key.', { cause: error });
  }
};

const metadataOf = (record) => {
  const metadata = Object.create(null);
  for (const name in record) {
    if (!OWN_FIELDS.has(name) && typeof record[name] === 'string') metadata[name] = record[name];
  }
  return metadata;
};

// The id SendGrid gives a message is the X-Message-Id of its answer, the
// receipt's, followed by a dot and the id of a filter.
const messageIdOf = (record) => {
  const id = stringOf(record.sg_message_id);
  if (id === undefined) return undefined;
  const dot = id.indexOf('.');
  return dot > 0 ? id.slice(0, dot) : id;
};

// A bounce is hard, a block or a message that expired after its retries soft;
// one of no type does not say.
const SENDGRID_BOUNCE_KINDS = new Map([
  ['bounce', 'hard'],
  ['blocked', 'soft'],
  ['expired', 'soft'],
]);

const eventOf = (record, index, timestamp) => {
  const type = TYPES.get(record.event) ?? 'unknown';
  let bounce;
  if (record.event === 'bounce') {
    bounce = { kind: SENDGRID_BOUNCE_KINDS.get(record.type) ?? 'undetermined' };
    if (stringOf(record.status) !== undefined) bounce.code = record.status;
    if (stringOf(record.reason) !== undefined) bounce.diagnostic = record.reason;
  }
  return createEvent({
    provider: 'sendgrid',
    type,
    id: stringOf(record.sg_event_id) ?? `${timestamp}:${index}`,
    messageId: messageIdOf(record),
    // The Message-ID of the message as it was sent.
    rfcMessageId: stringOf(record['smtp-id']),
    recipient: stringOf(record.email),
    occurredAt: dateOf(record.timestamp),
    bounce,
    reason:
      stringOf(record.bounce_classification) ??
      stringOf(record.reason) ??
      stringOf(record.response),
    url: stringOf(record.url),
    tags: stringListOf(record.category),
    metadata: metadataOf(record),
    raw: record,
  });
};

/**
 * Makes the verifier of SendGrid's Signed Event Webhook.
 *
 * @param options `publicKey`, its verification key (base64 of the key, or
 * PEM); `replayStore`; `now`, `toleranceMs` (five minutes), `leaseMs` and
 * `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events, commit, release }`.
 * @throws {TypeError} If an option is invalid.
 */
const createSendGridWebhookVerifier = (options = {}) => {
  const key = publicKeyOf(options.publicKey);
  const common = resolveCommonOptions(options, DEFAULT_TOLERANCE_MS);
  return {
    verify: observed(common, 'sendgrid', async (request) => {
      const bytes = bodyBytesOf(request, common);
      const signature = headerOf(request, SIGNATURE);
      const timestamp = headerOf(request, TIMESTAMP);
      if (signature === undefined || timestamp === undefined) {
        throw new WebhookVerificationError('signature', 'The request has no SendGrid signature.');
      }
      const signed = Buffer.concat([Buffer.from(timestamp, 'utf8'), bytes]);
      if (!verifySignature('sha256', signed, key, Buffer.from(signature, 'base64'))) {
        throw new WebhookVerificationError('signature', 'The SendGrid signature does not match.');
      }
      checkSignedSeconds(timestamp, common, 'SendGrid');
      const payload = parseJsonOf(bytes);
      if (!Array.isArray(payload)) {
        throw new WebhookVerificationError('payload', 'The body is not a list of SendGrid events.');
      }
      // A batch SendGrid sends again keeps the ids of its events: those taken
      // before are left out, and a batch of nothing new is a replay.
      const entries = [];
      for (let index = 0; index < payload.length; index++) {
        if (!isRecord(payload[index])) continue;
        const event = eventOf(payload[index], index, timestamp);
        entries.push({ key: `sendgrid:${event.id}`, events: [event] });
      }
      return claimDelivery(common, entries);
    }),
  };
};

module.exports = { createSendGridWebhookVerifier };
