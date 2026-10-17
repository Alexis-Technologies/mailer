// Not ported: the events of Mailtrap's sending webhooks, signed with an HMAC
// of the raw body (https://docs.mailtrap.io/email-api-smtp/advanced/webhooks).
// sently and unemail have no Mailtrap webhook.

const {
  DAY_REPLAY_TTL_MS,
  WebhookVerificationError,
  bodyBytesOf,
  checkBodyHmac,
  claimDelivery,
  createEvent,
  dateOf,
  isRecord,
  observed,
  parseJsonOf,
  requireSecret,
  resolveCommonOptions,
  stringOf,
  stringRecordOf,
} = require('./request.js');

// Mailtrap signs no time and retries for up to a day: an event id is kept a
// day and an hour.
const TYPES = new Map([
  ['delivery', 'delivered'],
  ['soft bounce', 'bounced'],
  ['bounce', 'bounced'],
  ['suspension', 'rejected'],
  ['reject', 'rejected'],
  ['spam', 'complained'],
  ['unsubscribe', 'unsubscribed'],
  ['open', 'opened'],
  ['click', 'clicked'],
]);
const TAG_VARIABLE = /^tag_/;

// The records of a body: `{ events: [...] }`, or JSON Lines, one event a line.
const recordsOf = (bytes) => {
  let payload;
  try {
    payload = parseJsonOf(bytes);
  } catch {
    payload = undefined;
  }
  if (isRecord(payload)) return Array.isArray(payload.events) ? payload.events : [payload];
  if (payload !== undefined) {
    throw new WebhookVerificationError('payload', 'The body is not a list of Mailtrap events.');
  }
  const records = [];
  for (const line of Buffer.from(bytes).toString('utf8').split('\n')) {
    if (line.trim() !== '') records.push(parseJsonOf(Buffer.from(line, 'utf8')));
  }
  return records;
};

// As `./mailtrap` sends them: the first tag is the category, the others
// `tag_<tag>` variables, and the other variables the metadata.
const tagsAndMetadataOf = (record) => {
  const tags = [];
  if (stringOf(record.category) !== undefined) tags.push(record.category);
  const variables = stringRecordOf(record.custom_variables);
  const metadata = Object.create(null);
  for (const name in variables) {
    if (TAG_VARIABLE.test(name)) tags.push(variables[name]);
    else metadata[name] = variables[name];
  }
  return { tags, metadata };
};

const eventOf = (record) => {
  const type = TYPES.get(record.event) ?? 'unknown';
  let bounce;
  if (type === 'bounced') {
    bounce = { kind: record.event === 'bounce' ? 'hard' : 'soft' };
    if (record.response_code !== undefined && record.response_code !== null) {
      bounce.code = String(record.response_code);
    }
    if (stringOf(record.response) !== undefined) bounce.diagnostic = record.response;
  }
  const { tags, metadata } = tagsAndMetadataOf(record);
  return createEvent({
    provider: 'mailtrap',
    type,
    id: stringOf(record.event_id) ?? `${record.message_id}:${record.event}:${record.email}`,
    messageId: stringOf(record.message_id),
    recipient: stringOf(record.email),
    occurredAt: dateOf(record.timestamp),
    bounce,
    reason: stringOf(record.bounce_category) ?? stringOf(record.reason),
    url: stringOf(record.url),
    tags,
    metadata,
    raw: record,
  });
};

/**
 * Makes the verifier of Mailtrap's sending webhooks: the HMAC-SHA256 of the
 * body, in hexadecimal in `Mailtrap-Signature`, with the signing secret of
 * the webhook; a body of JSON or JSON Lines.  Mailtrap signs no time, so each
 * event is taken once by its `event_id`, kept a day and an hour.
 *
 * @param options `secret`; `replayStore`; `leaseMs` and `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events, commit, release }`.
 * @throws {TypeError} If an option is invalid.
 */
const createMailtrapWebhookVerifier = (options = {}) => {
  const secret = requireSecret(
    options.secret,
    'secret is the signing secret of the Mailtrap webhook.',
  );
  const common = resolveCommonOptions(options, DAY_REPLAY_TTL_MS);
  return {
    verify: observed(common, 'mailtrap', async (request) => {
      const bytes = bodyBytesOf(request, common);
      checkBodyHmac(request, bytes, 'mailtrap-signature', secret, 'Mailtrap');
      const entries = [];
      for (const record of recordsOf(bytes)) {
        if (!isRecord(record)) continue;
        const event = eventOf(record);
        entries.push({ key: `mailtrap:${event.id}`, events: [event] });
      }
      return claimDelivery(common, entries, {}, DAY_REPLAY_TTL_MS);
    }),
  };
};

module.exports = { createMailtrapWebhookVerifier };
