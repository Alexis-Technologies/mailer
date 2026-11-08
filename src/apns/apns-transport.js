// Not ported: a transport of pushes over APNs, the request of
// message-converter.js through the HTTP/2 client of http-client.js, the
// `apns-id` its receipt's id.

const { sendConverted } = require('../internal/api-steps.js');
const { channelFailure } = require('../internal/channel/failure.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { createApnsConfig } = require('./config.js');
const { createApnsClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

const PROVIDER = 'apns';

/**
 * A transport of pushes over the Apple Push Notification service.
 */
class ApnsTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createApnsConfig, createApnsClient);
  }

  /**
   * Sends one push to the token of a device.
   *
   * @param message A push.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the `apns-id` its id.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    let push;
    return sendConverted(message, options, {
      provider: PROVIDER,
      convert: (sent) => {
        push = convertMessage(sent, this.config);
        return push;
      },
      request: (converted, sendOptions) => this.httpClient.send(converted, sendOptions),
      // The id APNs answers, which is the one it was sent, never one of the
      // transport's own (V9).
      receiptOf: (answer) => ({
        successful: true,
        messageId: answer.headers.get('apns-id') ?? push.id,
        provider: PROVIDER,
        channel: 'push',
        state: 'sent',
      }),
      failureOf: (error) => channelFailure(PROVIDER, 'push', error),
    });
  }

  /** Closes the HTTP/2 sessions, the pushes out on them let finish. */
  async [Symbol.asyncDispose]() {
    await this.httpClient.close();
  }
}

module.exports = { ApnsTransport };
