// Not ported: a transport of Web Push, the receipt of a push a push service
// took: its `Location`, the resource of the message, as its id, or an id of
// the transport's own for a service that names none.

const { generateId } = require('../core/id.js');
const { sendConverted } = require('../internal/api-steps.js');
const { channelFailure } = require('../internal/channel/failure.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { createWebPushConfig } = require('./config.js');
const { createWebPushClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

const PROVIDER = 'webpush';

/**
 * A transport of Web Push (RFC 8030, RFC 8291, RFC 8292) to the
 * subscriptions of browsers.
 */
class WebPushTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createWebPushConfig, createWebPushClient);
  }

  /**
   * Sends one push to a subscription.
   *
   * @param message A push, to a subscription of Web Push.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the `Location` of the message its id.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: PROVIDER,
      convert: (sent) => convertMessage(sent, this.config),
      request: (push, sendOptions) =>
        this.httpClient.push(push.endpoint, push.body, push.headers, sendOptions),
      receiptOf: (answer) => ({
        successful: true,
        messageId:
          answer.headers.get('location') ??
          `webpush:${generateId('message-id', this.config.generateId)}`,
        provider: PROVIDER,
        channel: 'push',
        state: 'sent',
      }),
      failureOf: (error) => channelFailure(PROVIDER, 'push', error),
    });
  }
}

module.exports = { WebPushTransport };
