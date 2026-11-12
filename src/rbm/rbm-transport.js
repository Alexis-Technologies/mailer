// Not ported: a transport of RCS over Google's RCS Business Messaging, the
// AgentMessage of message-converter.js under a messageId of the client:
// derived from the idempotency key, so that a send again of the same
// message is refused as one the API has, rather than delivered twice.

const { createFailedReceipt } = require('../core/receipt.js');
const { sendConverted } = require('../internal/api-steps.js');
const { channelFailure } = require('../internal/channel/failure.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { generateId } = require('../core/id.js');
const { toUuid } = require('../internal/uuid.js');
const { createRbmConfig } = require('./config.js');
const { createRbmClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

const PROVIDER = 'rbm';

const failureOf = (error) => {
  if (error?.receiptCode === 'rbm.ALREADY_EXISTS') {
    // The API holds a message of this id: it went then.
    return createFailedReceipt('RBM already took a message with this id; it is not sent again.', {
      provider: PROVIDER,
      channel: 'rcs',
      category: 'unknown',
      deliveryUnknown: true,
      deliveryUnknownReason: 'duplicate',
      code: 'rbm.ALREADY_EXISTS',
    });
  }
  return channelFailure(PROVIDER, 'rcs', error);
};

/**
 * A transport of RCS over the RCS Business Messaging API of Google.
 */
class RbmTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createRbmConfig, createRbmClient);
  }

  /**
   * Sends one message of RCS from the agent.
   *
   * @param message A message of RCS.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the messageId its id.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    // A UUID, which the API asks of a messageId: of the key, or of an id the
    // generator of the transport gives, whatever its shape.
    const messageId = toUuid(
      message.idempotencyKey ?? generateId('idempotency-key', this.config.generateId),
    );
    return sendConverted(message, options, {
      provider: PROVIDER,
      convert: (sent) => convertMessage(sent),
      request: (body, sendOptions) =>
        this.httpClient.send(message.to, messageId, body, sendOptions),
      receiptOf: () => ({
        successful: true,
        messageId,
        provider: PROVIDER,
        channel: 'rcs',
        state: 'accepted',
      }),
      failureOf,
    });
  }
}

module.exports = { RbmTransport };
