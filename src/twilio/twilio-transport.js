// Ported from @thinwrap/notifications v1.2.0 (src/providers/twilio/twilio.connector.ts):
// a transport over the Messages API of Twilio, the sid of a message as its
// id.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: a message Twilio took is `accepted`, with the status
// Twilio gives it, as its delivery is told later, where thinwrap made it
// `sent` (T1); its segments are the receipt's (`num_segments`); and WhatsApp
// and RCS go through the same request, by the prefix of their recipient.

const { createFailedReceipt } = require('../core/receipt.js');
const { sendConverted } = require('../internal/api-steps.js');
const { channelFailure } = require('../internal/channel/failure.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { verifyByGet } = require('../internal/verify.js');
const { createTwilioConfig } = require('./config.js');
const { createTwilioClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

const PROVIDER = 'twilio';
const MESSAGE_SID = /^(?:SM|MM)[0-9a-f]{32}$/;

const receiptOf = (json, channel) => {
  if (typeof json?.sid !== 'string' || !MESSAGE_SID.test(json.sid)) {
    return createFailedReceipt('Twilio answered without the sid of the message.', {
      provider: PROVIDER,
      channel,
      category: 'unknown',
      deliveryUnknown: true,
      deliveryUnknownReason: 'no-id',
    });
  }
  const receipt = {
    successful: true,
    messageId: json.sid,
    provider: PROVIDER,
    channel,
    state: 'accepted',
  };
  const segments = Number(json.num_segments);
  if (Number.isInteger(segments) && segments > 0) receipt.segments = segments;
  return receipt;
};

/**
 * A transport of SMS, MMS, WhatsApp and RCS over the Messages API of Twilio.
 */
class TwilioTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createTwilioConfig, createTwilioClient);
  }

  /**
   * Sends one message.
   *
   * @param message A message of SMS, WhatsApp or RCS.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the sid of the message its id.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    const channel = message?.channel;
    return sendConverted(message, options, {
      provider: PROVIDER,
      now: this.config.now,
      convert: (sent) => convertMessage(sent, this.config),
      request: (form, sendOptions) => this.httpClient.create(form, sendOptions),
      receiptOf: (answer) => receiptOf(answer.json, channel),
      failureOf: (error) => channelFailure(PROVIDER, channel, error),
    });
  }

  /**
   * Checks the credentials by reading the account.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Twilio refuses them.
   */
  verify(options) {
    return verifyByGet(this, 'Twilio', `${this.httpClient.accountUrl}.json`, options);
  }
}

module.exports = { TwilioTransport };
