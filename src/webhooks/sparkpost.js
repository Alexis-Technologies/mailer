// Not ported: the events of SparkPost's webhooks, which authenticate with
// Basic credentials (https://developers.sparkpost.com/api/webhooks/).
// sently and unemail have no SparkPost webhook.

const {
  WebhookVerificationError,
  basicCredentialsOf,
  bodyBytesOf,
  checkBasicCredentials,
  createEvent,
  dateOf,
  deliveryOf,
  isRecord,
  observed,
  parseJsonOf,
  resolveCredentialOptions,
  stringOf,
  stringRecordOf,
  stringsOf,
} = require('./request.js');

const TYPES = new Map([
  ['injection', 'accepted'],
  ['delivery', 'delivered'],
  ['delay', 'deferred'],
  ['bounce', 'bounced'],
  ['out_of_band', 'bounced'],
  ['spam_complaint', 'complained'],
  ['policy_rejection', 'rejected'],
  ['generation_failure', 'rejected'],
  ['generation_rejection', 'rejected'],
  ['list_unsubscribe', 'unsubscribed'],
  ['link_unsubscribe', 'unsubscribed'],
  ['open', 'opened'],
  ['initial_open', 'opened'],
  ['amp_open', 'opened'],
  ['amp_initial_open', 'opened'],
  ['click', 'clicked'],
  ['amp_click', 'clicked'],
]);
// SparkPost's bounce classes: 10 Invalid Recipient, 30 Generic Bounce (No
// RCPT) and 90 Unsubscribe are hard; 1 Undetermined; the others soft.
const HARD_CLASSES = new Set(['10', '30', '90']);

const bounceOf = (event) => {
  const bounceClass = event.bounce_class === undefined ? undefined : String(event.bounce_class);
  let kind = 'soft';
  if (bounceClass === undefined || bounceClass === '1') kind = 'undetermined';
  else if (HARD_CLASSES.has(bounceClass)) kind = 'hard';
  const bounce = { kind };
  if (stringOf(event.error_code) !== undefined) bounce.code = event.error_code;
  const diagnostic = stringOf(event.raw_reason) ?? stringOf(event.reason);
  if (diagnostic !== undefined) bounce.diagnostic = diagnostic;
  return bounce;
};

// The event inside a record: `{ msys: { message_event: {...} } }`, or a
// track, generation, unsubscribe or relay event.
const innerOf = (record) => {
  const msys = record.msys;
  if (!isRecord(msys)) return undefined;
  for (const name in msys) {
    if (isRecord(msys[name])) return msys[name];
  }
  return undefined;
};

const eventOf = (inner, index) => {
  const type = TYPES.get(inner.type) ?? 'unknown';
  return createEvent({
    provider: 'sparkpost',
    type,
    id: stringOf(inner.event_id) ?? `${inner.transmission_id}:${inner.type}:${index}`,
    // The transmission is what a send of `./sparkpost` answers with.
    messageId: stringOf(inner.transmission_id),
    recipient: stringOf(inner.rcpt_to) ?? stringOf(inner.raw_rcpt_to),
    occurredAt: dateOf(inner.timestamp),
    bounce: type === 'bounced' ? bounceOf(inner) : undefined,
    reason: stringOf(inner.reason) ?? stringOf(inner.raw_reason),
    url: stringOf(inner.target_link_url),
    tags: stringsOf(inner.rcpt_tags),
    metadata: stringRecordOf(inner.rcpt_meta),
    raw: inner,
  });
};

/**
 * Makes the verifier of SparkPost's webhooks, configured with Basic
 * authentication, as SparkPost signs nothing.  The message id is the
 * transmission's, the receipt's id; the tags and metadata are those of the
 * recipient.
 *
 * @param options `username`, `password` and `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events, commit, release }`;
 * committing does nothing, as nothing is kept.
 * @throws {TypeError} If a credential is missing.
 */
const createSparkPostWebhookVerifier = (options = {}) => {
  const expected = basicCredentialsOf(options, 'SparkPost');
  const common = resolveCredentialOptions(options);
  return {
    verify: observed(common, 'sparkpost', async (request) => {
      const bytes = bodyBytesOf(request, common);
      checkBasicCredentials(request, expected);
      const payload = parseJsonOf(bytes);
      if (!Array.isArray(payload)) {
        throw new WebhookVerificationError(
          'payload',
          'The body is not a list of SparkPost events.',
        );
      }
      const events = [];
      for (let index = 0; index < payload.length; index++) {
        const inner = isRecord(payload[index]) ? innerOf(payload[index]) : undefined;
        if (inner !== undefined) events.push(eventOf(inner, index));
      }
      return deliveryOf(events);
    }),
  };
};

module.exports = { createSparkPostWebhookVerifier };
