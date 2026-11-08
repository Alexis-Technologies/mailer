// Not ported: an SMS as the request of SendTextMessage of AWS End User
// Messaging SMS: its number, its sender (an origination identity: a number,
// a sender id, a pool), its type by its priority, its time to live, its
// configuration set, and its correlation id as the `Context` its events give
// back.

const { InvalidMessageError } = require('../internal/channel/failure.js');
const { RefusalError } = require('../internal/refusal.js');

const MAX_BODY = 1600;
const MIN_TTL_SECONDS = 5;
const MAX_TTL_SECONDS = 259200;
const MAX_CONTEXT = 5;
const OWN_FIELDS = new Set(['DestinationPhoneNumber', 'MessageBody']);
// The type of a message of a priority; one of normal priority is of the
// transport's `messageType`.
const TYPES = new Map([
  ['high', 'TRANSACTIONAL'],
  ['low', 'PROMOTIONAL'],
]);

const invalid = (message) => new InvalidMessageError(`AWS SMS: ${message}`);
const unsupported = (message) => new RefusalError(`AWS SMS: ${message}`);

// What AWS takes of a context: a key of 1 to 100 characters, a value of 1 to
// 1000 that neither starts nor ends with a space.
const MAX_CONTEXT_KEY = 100;
const MAX_CONTEXT_VALUE = 1000;
const isContextEntry = (key, value) =>
  key.length <= MAX_CONTEXT_KEY &&
  value.length > 0 &&
  value.length <= MAX_CONTEXT_VALUE &&
  value.trim().length === value.length;

// The context of a message, five keys at most, the correlation id first, of
// the entries AWS takes: one it would refuse is left out rather than fail
// the SMS, as the metadata is not the message.
const contextOf = (metadata) => {
  if (metadata === undefined) return undefined;
  const context = {};
  let count = 0;
  const correlationId = metadata.correlationId;
  if (correlationId !== undefined && isContextEntry('correlationId', correlationId)) {
    context.correlationId = correlationId;
    count++;
  }
  for (const key in metadata) {
    if (count === MAX_CONTEXT) break;
    if (key === 'correlationId' || !isContextEntry(key, metadata[key])) continue;
    context[key] = metadata[key];
    count++;
  }
  return count === 0 ? undefined : context;
};

/**
 * The body of SendTextMessage.
 *
 * @param message The SMS, of `createChannelMessage`.
 * @param config The configuration.
 * @returns The body.
 * @throws {InvalidMessageError} If the API would refuse it.
 * @throws {RefusalError} If it holds what an SMS cannot carry.
 * @internal
 */
const convertMessage = (message, config) => {
  if (message.channel !== 'sms') {
    throw unsupported(`the transport sends SMS, not messages of ${message.channel ?? 'email'}.`);
  }
  if (message.media !== undefined && message.media.length > 0) {
    throw unsupported('an MMS goes through SendMediaMessage, which this transport does not send.');
  }
  if (message.buttons !== undefined) throw unsupported('an SMS carries no buttons.');
  if (message.text === undefined || message.text === '') throw invalid('an SMS needs a text.');
  if (message.text.length > MAX_BODY) {
    throw invalid(`the text is more than ${MAX_BODY} characters.`);
  }
  const body = { DestinationPhoneNumber: message.to, MessageBody: message.text };
  const origination = message.from ?? config.originationIdentity;
  if (origination !== undefined) body.OriginationIdentity = origination;
  body.MessageType = TYPES.get(message.priority) ?? config.messageType;
  if (config.configurationSetName !== undefined) {
    body.ConfigurationSetName = config.configurationSetName;
  }
  if (message.expiresAt !== undefined) {
    const seconds = Math.ceil((message.expiresAt.getTime() - config.now()) / 1000);
    body.TimeToLive = Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, seconds));
  }
  const context = contextOf(message.metadata);
  if (context !== undefined) body.Context = context;
  if (message.payload !== undefined) {
    for (const name in message.payload) {
      if (OWN_FIELDS.has(name)) throw invalid(`the payload cannot set ${name}.`);
      body[name] = message.payload[name];
    }
  }
  return body;
};

module.exports = { convertMessage };
