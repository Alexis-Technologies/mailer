// Not ported: the events of SMTP2GO's webhooks, whose URL carries Basic
// credentials (https://developers.smtp2go.com/docs/webhooks-overview).
// sently and unemail have no SMTP2GO webhook.

const {
  WebhookVerificationError,
  basicCredentialsOf,
  bodyBytesOf,
  checkBasicCredentials,
  createEvent,
  dateOf,
  deliveryOf,
  isRecord,
  headerValueOf,
  metadataFromHeaders,
  resolveCredentialOptions,
  stringOf,
} = require('./request.js');

const TYPES = new Map([
  ['processed', 'accepted'],
  ['delivered', 'delivered'],
  ['bounce', 'bounced'],
  ['reject', 'rejected'],
  ['spam', 'complained'],
  ['unsubscribe', 'unsubscribed'],
  ['open', 'opened'],
  ['click', 'clicked'],
]);
const UTF8 = new TextDecoder('utf-8', { fatal: true });

// A body of JSON or of a form, as the webhook is set up.
const recordOf = (bytes) => {
  let text;
  try {
    text = UTF8.decode(bytes);
  } catch (error) {
    throw new WebhookVerificationError('payload', 'The body is not UTF-8.', { cause: error });
  }
  if (text.trimStart().startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new WebhookVerificationError('payload', 'The body is not JSON.', { cause: error });
    }
  }
  const record = Object.create(null);
  for (const [name, value] of new URLSearchParams(text)) record[name] = value;
  return record;
};

const eventOf = (record) => {
  const type = TYPES.get(record.event) ?? 'unknown';
  let bounce;
  if (type === 'bounced') {
    let kind = 'undetermined';
    if (record.bounce === 'hard' || record.bounce === 'soft') kind = record.bounce;
    bounce = { kind };
    if (stringOf(record.message) !== undefined) bounce.diagnostic = record.message;
  }
  const messageId = stringOf(record.email_id);
  const recipient = stringOf(record.rcpt);
  const at = record.time ?? record.sendtime;
  return createEvent({
    provider: 'smtp2go',
    type,
    id: stringOf(record.id) ?? `${record.event}:${messageId}:${recipient}:${at}`,
    messageId,
    rfcMessageId: headerValueOf(record, 'message-id'),
    recipient,
    occurredAt: dateOf(at),
    bounce,
    reason: stringOf(record.message),
    url: stringOf(record.url),
    metadata: metadataFromHeaders(record),
    raw: record,
  });
};

/**
 * Makes the verifier of SMTP2GO's webhooks, whose URL carries Basic
 * credentials, as SMTP2GO signs nothing; a body of JSON or of a form.  The
 * message id is the `email_id`, the receipt's; the metadata comes back from
 * `X-Metadata-<key>` fields when the webhook adds them to its payload.
 *
 * @param options `username`, `password` and `maxBodyBytes`.
 * @returns `{ verify(request) }`, which gives `{ events, commit, release }`;
 * committing does nothing, as nothing is kept.
 * @throws {TypeError} If a credential is missing.
 */
const createSmtp2goWebhookVerifier = (options = {}) => {
  const expected = basicCredentialsOf(options, 'SMTP2GO');
  const common = resolveCredentialOptions(options);
  return {
    async verify(request) {
      const bytes = bodyBytesOf(request, common);
      checkBasicCredentials(request, expected);
      const record = recordOf(bytes);
      if (!isRecord(record) || typeof record.event !== 'string') {
        throw new WebhookVerificationError('payload', 'The body is not an SMTP2GO event.');
      }
      return deliveryOf([eventOf(record)]);
    },
  };
};

module.exports = { createSmtp2goWebhookVerifier };
