// Ported from @thinwrap/notifications v1.2.0 (src/providers/infobip/infobip.connector.ts):
// a transport over `/sms/3/messages` of the SMS API of Infobip, whose 200
// gives each message a status, a refusal in the group REJECTED among them.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: a status of the groups UNDELIVERABLE and EXPIRED is a
// refusal too; the correlation id is the `callbackData` the delivery reports
// give back, and the receipt's segments the `messageCount` Infobip counted.

const { createFailedReceipt } = require('../core/receipt.js');
const { sendConverted } = require('../internal/api-steps.js');
const { channelFailure, InvalidMessageError } = require('../internal/channel/failure.js');
const { countSegments } = require('../internal/channel/segments.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { RefusalError } = require('../internal/refusal.js');
const { verifyByGet } = require('../internal/verify.js');
const { createInfobipConfig } = require('./config.js');
const { classifyStatus, createInfobipClient, isFailedStatus } = require('./http-client.js');

const PROVIDER = 'infobip';
const MINUTE_MS = 60_000;
const MAX_VALIDITY_MINUTES = 2880;
const OWN_FIELDS = new Set(['destinations']);

const invalid = (message) => new InvalidMessageError(`Infobip: ${message}`);
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// The fields of a payload over those of the message, an object of both
// merged one level down (`options`, `webhooks`, `content`).
const applyPayload = (entry, payload) => {
  for (const name in payload) {
    const value = payload[name];
    if (OWN_FIELDS.has(name)) throw invalid(`the payload cannot set ${name}.`);
    if (name === 'content' && value?.text !== undefined) {
      throw invalid('the payload cannot set content.text.');
    }
    entry[name] = isObject(value) && isObject(entry[name]) ? { ...entry[name], ...value } : value;
  }
};

const bodyOf = (message, config) => {
  if (message.channel !== 'sms') {
    throw new RefusalError(
      `Infobip: the transport sends SMS, not messages of ${message.channel ?? 'email'}.`,
    );
  }
  if (message.media !== undefined && message.media.length > 0) {
    throw new RefusalError('Infobip: an SMS carries no media.');
  }
  if (message.buttons !== undefined) throw new RefusalError('Infobip: an SMS carries no buttons.');
  if (message.text === undefined || message.text === '') throw invalid('an SMS needs a text.');
  const entry = { destinations: [{ to: message.to.slice(1) }], content: { text: message.text } };
  const sender = message.from ?? config.from;
  if (sender !== undefined) entry.sender = sender;
  if (message.expiresAt !== undefined) {
    const minutes = Math.floor((message.expiresAt.getTime() - config.now()) / MINUTE_MS);
    entry.options = {
      validityPeriod: {
        amount: Math.min(MAX_VALIDITY_MINUTES, Math.max(1, minutes)),
        timeUnit: 'MINUTES',
      },
    };
  }
  const correlationId = message.metadata?.correlationId;
  if (correlationId !== undefined || config.notifyUrl !== undefined) {
    entry.webhooks = {};
    if (config.notifyUrl !== undefined) {
      entry.webhooks.delivery = { url: config.notifyUrl };
      entry.webhooks.contentType = 'application/json';
    }
    if (correlationId !== undefined) entry.webhooks.callbackData = correlationId;
  }
  if (message.payload !== undefined) applyPayload(entry, message.payload);
  return { messages: [entry], options: { includeSmsCountInResponse: true } };
};

// The receipt of the status of the message: a refusal of its group, or
// accepted with the parts Infobip counted, of unknown delivery without an id.
const receiptOf = (json, message) => {
  const sent = Array.isArray(json?.messages) ? json.messages[0] : undefined;
  const status = sent?.status;
  if (isFailedStatus(status)) {
    const reason = status.description ?? status.name ?? 'the message was refused';
    return createFailedReceipt(`Infobip: ${reason}`, {
      provider: PROVIDER,
      channel: 'sms',
      ...classifyStatus(status),
      // The status, not the answer, whose message names its destination.
      providerDetails: { status },
    });
  }
  if (typeof sent?.messageId !== 'string' || sent.messageId === '') {
    return createFailedReceipt('Infobip answered without the id of the message.', {
      provider: PROVIDER,
      channel: 'sms',
      category: 'unknown',
      deliveryUnknown: true,
      deliveryUnknownReason: 'no-id',
    });
  }
  const count = sent.details?.messageCount;
  return {
    successful: true,
    messageId: sent.messageId,
    provider: PROVIDER,
    channel: 'sms',
    state: 'accepted',
    segments: Number.isInteger(count) && count > 0 ? count : countSegments(message.text).segments,
  };
};

/**
 * A transport of SMS over the SMS API of Infobip.
 */
class InfobipTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createInfobipConfig, createInfobipClient);
  }

  /**
   * Sends one SMS.
   *
   * @param message An SMS.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the id Infobip gave the message its id.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: PROVIDER,
      now: this.config.now,
      convert: (sent) => bodyOf(sent, this.config),
      request: (body, sendOptions) => this.httpClient.send(body, sendOptions),
      receiptOf: (answer) => receiptOf(answer.json, message),
      failureOf: (error) => channelFailure(PROVIDER, 'sms', error),
    });
  }

  /**
   * Checks the key by reading the balance of the account; a key whose
   * scopes leave out the balance is refused it with a 403, and verified.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Infobip refuses the key.
   */
  verify(options) {
    return verifyByGet(this, 'Infobip', this.httpClient.balanceUrl, options, {
      acceptForbidden: true,
    });
  }
}

module.exports = { InfobipTransport };
