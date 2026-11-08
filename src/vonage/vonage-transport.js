// Ported from @thinwrap/notifications v1.2.0 (src/providers/vonage/vonage.connector.ts):
// a transport over the SMS API of Vonage, its text as `unicode` when it is
// no text of GSM-7.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: every part of a message is read, where thinwrap read
// `messages[0]` alone and lost the segments and a failure of a later part
// (T2): the receipt's segments are the `message-count`, and a message whose
// parts went in part is of unknown delivery, as the recipient may hold the
// first; the correlation id is the `client-ref` its receipts give back.

const { createFailedReceipt } = require('../core/receipt.js');
const { sendConverted } = require('../internal/api-steps.js');
const { channelFailure, InvalidMessageError } = require('../internal/channel/failure.js');
const { countSegments } = require('../internal/channel/segments.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { RefusalError } = require('../internal/refusal.js');
const { verifyByGet } = require('../internal/verify.js');
const { createVonageConfig } = require('./config.js');
const { classifyStatus, createVonageClient } = require('./http-client.js');

const PROVIDER = 'vonage';
const MAX_TEXT = 3200;
const MAX_CLIENT_REF = 40;
const MIN_TTL_MS = 20_000;
const MAX_TTL_MS = 604_800_000;
const OWN_FIELDS = new Set(['api_key', 'api_secret', 'to', 'text']);

const invalid = (message) => new InvalidMessageError(`Vonage: ${message}`);

const formOf = (message, config) => {
  if (message.channel !== 'sms') {
    throw new RefusalError(
      `Vonage: the transport sends SMS, not messages of ${message.channel ?? 'email'}.`,
    );
  }
  if (message.media !== undefined && message.media.length > 0) {
    throw new RefusalError('Vonage: an SMS carries no media.');
  }
  if (message.buttons !== undefined) throw new RefusalError('Vonage: an SMS carries no buttons.');
  if (message.text === undefined || message.text === '') throw invalid('an SMS needs a text.');
  if (message.text.length > MAX_TEXT) {
    throw invalid(`the text is more than ${MAX_TEXT} characters.`);
  }
  const from = message.from ?? config.from;
  if (from === undefined) throw invalid('an SMS needs a sender: from.');
  const form = new URLSearchParams({
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    from,
    to: message.to.slice(1),
    text: message.text,
  });
  if (countSegments(message.text).encoding === 'UCS-2') form.set('type', 'unicode');
  const correlationId = message.metadata?.correlationId;
  if (correlationId !== undefined && correlationId.length <= MAX_CLIENT_REF) {
    form.set('client-ref', correlationId);
  }
  if (config.callback !== undefined) form.set('callback', config.callback);
  if (message.expiresAt !== undefined) {
    const ms = message.expiresAt.getTime() - config.now();
    form.set('ttl', String(Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, ms))));
  }
  if (message.payload !== undefined) {
    for (const name in message.payload) {
      if (OWN_FIELDS.has(name)) throw invalid(`the payload cannot set ${name}.`);
      form.set(name, String(message.payload[name]));
    }
  }
  return form;
};

// The receipt of the parts of a message: a success when every part went,
// a failure of the first that did not, of unknown delivery when some did.
const receiptOf = (json) => {
  const parts = Array.isArray(json?.messages) ? json.messages : [];
  if (parts.length === 0) {
    return createFailedReceipt('Vonage answered without the parts of the message.', {
      provider: PROVIDER,
      channel: 'sms',
      category: 'unknown',
      deliveryUnknown: true,
    });
  }
  let failed;
  let sent = 0;
  let unnamed = 0;
  for (const part of parts) {
    if (part?.status === '0') {
      sent++;
      // A part Vonage sent, of no id the receipt could carry.
      if (typeof part['message-id'] !== 'string') unnamed++;
    } else if (failed === undefined) failed = part;
  }
  if (failed !== undefined) {
    const classified = classifyStatus(String(failed?.status));
    return createFailedReceipt(`Vonage: ${failed?.['error-text'] ?? `status ${failed?.status}`}`, {
      provider: PROVIDER,
      channel: 'sms',
      ...classified,
      deliveryUnknown: sent > 0,
      segments: parts.length,
      providerDetails: json,
    });
  }
  if (unnamed > 0) {
    return createFailedReceipt('Vonage sent the message and named no id of a part.', {
      provider: PROVIDER,
      channel: 'sms',
      category: 'unknown',
      deliveryUnknown: true,
      segments: parts.length,
    });
  }
  const count = Number(json['message-count']);
  return {
    successful: true,
    messageId: parts[0]['message-id'],
    provider: PROVIDER,
    channel: 'sms',
    state: 'accepted',
    segments: Number.isInteger(count) && count > 0 ? count : parts.length,
  };
};

/**
 * A transport of SMS over the SMS API of Vonage.
 */
class VonageTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createVonageConfig, createVonageClient);
  }

  /**
   * Sends one SMS.
   *
   * @param message An SMS.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the id of its first part its id.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: PROVIDER,
      convert: (sent) => formOf(sent, this.config),
      request: (form, sendOptions) => this.httpClient.send(form, sendOptions),
      receiptOf: (answer) => receiptOf(answer.json),
      failureOf: (error) => channelFailure(PROVIDER, 'sms', error),
    });
  }

  /**
   * Checks the key and the secret by reading the balance of the account.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Vonage refuses them.
   */
  verify(options) {
    return verifyByGet(this, 'Vonage', this.httpClient.balanceUrl, options);
  }
}

module.exports = { VonageTransport };
