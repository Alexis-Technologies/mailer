// Not ported: a message of SMS, MMS, WhatsApp or RCS as the form of the
// Messages API of Twilio (https://www.twilio.com/docs/messaging/api/message-resource#create-a-message-resource):
// its recipient with the prefix of its channel, its sender or Messaging
// Service, its text and the URLs of its media, its validity, a template of
// the Content API, and the status callback with the correlation id in its
// query, which the signature of a callback covers.

const { InvalidMessageError } = require('../internal/channel/failure.js');
const { RefusalError } = require('../internal/refusal.js');

const MAX_BODY = 1600;
const MAX_MEDIA = 10;
const MAX_VALIDITY_SECONDS = 36000;
const CONTENT_SID = /^HX[0-9a-f]{32}$/;
const CHANNELS = new Set(['sms', 'whatsapp', 'rcs']);
const PREFIXES = new Map([
  ['sms', ''],
  ['whatsapp', 'whatsapp:'],
  ['rcs', 'rcs:'],
]);
const OWN_FIELDS = new Set(['To', 'From', 'Body']);
// The option of the sender of each channel.
const SENDERS = new Map([
  ['sms', 'from'],
  ['whatsapp', 'whatsappFrom'],
  ['rcs', 'rcsFrom'],
]);

const invalid = (message) => new InvalidMessageError(`Twilio: ${message}`);
const unsupported = (message) => new RefusalError(`Twilio: ${message}`);

// The sender of a message: its own, the one of its channel, or the
// Messaging Service, which chooses one.
const senderOf = (message, config) => {
  if (message.from !== undefined) {
    return { From: `${PREFIXES.get(message.channel)}${message.from}` };
  }
  const from = config[SENDERS.get(message.channel)];
  if (from !== undefined) return { From: `${PREFIXES.get(message.channel)}${from}` };
  if (config.messagingServiceSid !== undefined) {
    return { MessagingServiceSid: config.messagingServiceSid };
  }
  throw invalid(`a message of ${message.channel} needs a sender: from, or messagingServiceSid.`);
};

/**
 * The form of a message.
 *
 * @param message The message, of `createChannelMessage`.
 * @param config The configuration: the senders, `statusCallback`, `now`.
 * @returns The form, as URLSearchParams.
 * @throws {InvalidMessageError} If Twilio would refuse it.
 * @throws {RefusalError} If it holds what Twilio cannot send.
 * @internal
 */
const convertMessage = (message, config) => {
  if (!CHANNELS.has(message.channel)) {
    throw unsupported(
      `the transport sends SMS, WhatsApp and RCS, not ${message.channel ?? 'email'}.`,
    );
  }
  if (message.buttons !== undefined) {
    throw unsupported(
      'buttons go in a template of the Content API, its ContentSid in the payload.',
    );
  }
  const form = new URLSearchParams();
  form.set('To', `${PREFIXES.get(message.channel)}${message.to}`);
  const sender = senderOf(message, config);
  for (const name in sender) form.set(name, sender[name]);
  if (message.template !== undefined) {
    if (!CONTENT_SID.test(message.template.name)) {
      throw invalid(
        'the template of a message is the ContentSid (HX…) of a template of the Content API.',
      );
    }
    form.set('ContentSid', message.template.name);
    const variables = message.template.components?.[0];
    if (variables !== undefined) form.set('ContentVariables', JSON.stringify(variables));
  } else if (message.text !== undefined && message.text !== '') {
    if (message.text.length > MAX_BODY) {
      throw invalid(`the text is more than ${MAX_BODY} characters.`);
    }
    form.set('Body', message.text);
  }
  if (message.media !== undefined) {
    if (message.media.length > MAX_MEDIA) {
      throw invalid(`a message holds ${MAX_MEDIA} media at most.`);
    }
    for (const medium of message.media) {
      if (medium.url === undefined) throw unsupported('a medium is a URL Twilio fetches.');
      form.append('MediaUrl', medium.url);
    }
  }
  if (!form.has('Body') && !form.has('ContentSid') && !form.has('MediaUrl')) {
    throw invalid('a message needs a text, media or a template.');
  }
  if (message.expiresAt !== undefined) {
    const seconds = Math.ceil((message.expiresAt.getTime() - config.now()) / 1000);
    form.set('ValidityPeriod', String(Math.min(MAX_VALIDITY_SECONDS, Math.max(1, seconds))));
  }
  if (config.statusCallback !== undefined) {
    const callback = new URL(config.statusCallback);
    const correlationId = message.metadata?.correlationId;
    if (correlationId !== undefined) callback.searchParams.set('correlationId', correlationId);
    form.set('StatusCallback', callback.toString());
  }
  if (message.payload !== undefined) {
    for (const name in message.payload) {
      if (OWN_FIELDS.has(name)) throw invalid(`the payload cannot set ${name}.`);
      const value = message.payload[name];
      form.set(name, typeof value === 'string' ? value : JSON.stringify(value));
    }
  }
  return form;
};

module.exports = { convertMessage };
