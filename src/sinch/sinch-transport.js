// Ported from @thinwrap/notifications v1.2.0 (src/providers/sinch/sinch.connector.ts):
// a transport over the batches of the SMS API of Sinch, one recipient a batch.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: the correlation id is the `client_reference` the
// delivery reports give back, `expiresAt` the `expire_at` within the three
// days Sinch keeps a batch, and an answer without the id of the batch is of
// unknown delivery rather than a success with none.

const { sendConverted } = require('../internal/api-steps.js');
const {
  channelFailure,
  InvalidMessageError,
  noIdReceipt,
} = require('../internal/channel/failure.js');
const { countSegments } = require('../internal/channel/segments.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { RefusalError } = require('../internal/refusal.js');
const { verifyByGet } = require('../internal/verify.js');
const { createSinchConfig } = require('./config.js');
const { createSinchClient } = require('./http-client.js');

const PROVIDER = 'sinch';
const MAX_TEXT = 2000;
const MAX_EXPIRY_MS = 3 * 86_400_000;
const OWN_FIELDS = new Set(['to', 'body']);

const invalid = (message) => new InvalidMessageError(`Sinch: ${message}`);

const bodyOf = (message, config) => {
  if (message.channel !== 'sms') {
    throw new RefusalError(
      `Sinch: the transport sends SMS, not messages of ${message.channel ?? 'email'}.`,
    );
  }
  if (message.media !== undefined && message.media.length > 0) {
    throw new RefusalError('Sinch: an SMS carries no media.');
  }
  if (message.buttons !== undefined) throw new RefusalError('Sinch: an SMS carries no buttons.');
  if (message.text === undefined || message.text === '') throw invalid('an SMS needs a text.');
  if (message.text.length > MAX_TEXT) {
    throw invalid(`the text is more than ${MAX_TEXT} characters.`);
  }
  const body = { to: [message.to.slice(1)], body: message.text };
  const from = message.from ?? config.from;
  if (from !== undefined) body.from = from;
  // Past three days, the default of Sinch is the sooner.
  if (
    message.expiresAt !== undefined &&
    message.expiresAt.getTime() - config.now() < MAX_EXPIRY_MS
  ) {
    body.expire_at = message.expiresAt.toISOString();
  }
  const correlationId = message.metadata?.correlationId;
  if (correlationId !== undefined) body.client_reference = correlationId;
  if (config.callbackUrl !== undefined) body.callback_url = config.callbackUrl;
  if (config.deliveryReport !== undefined) body.delivery_report = config.deliveryReport;
  if (message.payload !== undefined) {
    for (const name in message.payload) {
      if (OWN_FIELDS.has(name)) throw invalid(`the payload cannot set ${name}.`);
      body[name] = message.payload[name];
    }
  }
  return body;
};

const receiptOf = (json, message) => {
  if (typeof json?.id !== 'string' || json.id === '') {
    return noIdReceipt('Sinch answered without the id of the batch.', PROVIDER, 'sms');
  }
  return {
    successful: true,
    messageId: json.id,
    provider: PROVIDER,
    channel: 'sms',
    state: 'accepted',
    segments: countSegments(message.text).segments,
  };
};

/**
 * A transport of SMS over the batches of the SMS API of Sinch.
 */
class SinchTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createSinchConfig, createSinchClient);
  }

  /**
   * Sends one SMS, a batch of one recipient.
   *
   * @param message An SMS.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the id of the batch its id.
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
   * Checks the service plan and its token by listing one batch.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Sinch refuses them.
   */
  verify(options) {
    return verifyByGet(this, 'Sinch', this.httpClient.listUrl, options);
  }
}

module.exports = { SinchTransport };
