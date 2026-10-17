// Not ported: the events of Mailtrap's sending webhooks, signed with an HMAC
// of the raw body (https://docs.mailtrap.io/email-api-smtp/advanced/webhooks).
// sently and unemail have no Mailtrap webhook.

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
  stringOf,
  stringRecordOf,
} = require('./request.js');

// Mailtrap signs no time and retries for up to a day: an event id is kept a
// day and an hour.
const REPLAY_TTL_MS = 25 * 60 * 60 * 1000;
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
 * @param options `secret`; `replayStore` and `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events }`.
 * @throws {TypeError} If an option is invalid.
 */
const createMailtrapWebhookVerifier = (options = {}) => {
  if (typeof options.secret !== 'string' || options.secret === '') {
    throw new TypeError('secret is the signing secret of the Mailtrap webhook.');
  }
  const secret = options.secret;
  const common = resolveCommonOptions(options, REPLAY_TTL_MS);
  return {
    async verify(request) {
      const bytes = bodyBytesOf(request, common);
      checkBodyHmac(request, bytes, 'mailtrap-signature', secret, 'Mailtrap');
      const events = [];
      let replayed = 0;
      for (const record of recordsOf(bytes)) {
        if (!isRecord(record)) continue;
        const event = eventOf(record);
        try {
          await checkReplay(common, `mailtrap:${event.id}`, REPLAY_TTL_MS);
        } catch (error) {
          if (error.reason !== 'replay') throw error;
          replayed++;
          continue;
        }
        events.push(event);
      }
      if (events.length === 0 && replayed > 0) {
        throw new WebhookVerificationError('replay', 'Every event of the batch was taken before.');
      }
      return { events };
    },
  };
};

module.exports = { createMailtrapWebhookVerifier };
