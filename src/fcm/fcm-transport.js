// Not ported: a transport of push notifications over FCM HTTP v1, the
// receipt of the message FCM took, its `name` the id.

const { createFailedReceipt } = require('../core/receipt.js');
const { sendConverted } = require('../internal/api-steps.js');
const { channelFailure } = require('../internal/channel/failure.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { createFcmConfig } = require('./config.js');
const { createFcmClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

const PROVIDER = 'fcm';

const receiptOf = (json) => {
  if (typeof json?.name !== 'string' || json.name === '') {
    return createFailedReceipt('FCM answered without the name of the message.', {
      provider: PROVIDER,
      channel: 'push',
      category: 'unknown',
      deliveryUnknown: true,
      deliveryUnknownReason: 'no-id',
    });
  }
  return {
    successful: true,
    messageId: json.name,
    provider: PROVIDER,
    channel: 'push',
    state: 'sent',
  };
};

/**
 * A transport of push notifications over FCM HTTP v1 (firebase.google.com).
 */
class FcmTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createFcmConfig, createFcmClient);
  }

  /**
   * Sends one push to a token or a topic.
   *
   * @param message A push.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the name of the message its id.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: PROVIDER,
      now: this.config.now,
      convert: (sent) => convertMessage(sent, this.config),
      request: (body, sendOptions) => this.httpClient.send(body, sendOptions),
      receiptOf: (answer) => receiptOf(answer.json),
      failureOf: (error) => channelFailure(PROVIDER, 'push', error),
    });
  }

  /**
   * Checks the service account and the project with a message FCM validates
   * and does not send (`validate_only`), to a topic.
   *
   * @param options Optional abort signal.
   * @throws {Error} If FCM refuses the account or the project.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    const answer = await this.httpClient.request({
      url: this.httpClient.sendUrl,
      body: { validate_only: true, message: { topic: 'mailer-verify', data: { verify: '1' } } },
      signal: options?.signal,
      // A dry run sends nothing: it is retried as a read is.
      isIdempotent: true,
    });
    if (typeof answer.json?.name !== 'string') {
      throw new Error('FCM answered the dry run with no name.');
    }
  }
}

module.exports = { FcmTransport };
