// Not ported: a transport of messages of Google Chat: to the space of a
// webhook, or to a space of a Chat app under a request id of the
// idempotency key, the `name` of the message the id of the receipt.

const { createFailedReceipt } = require('../core/receipt.js');
const { sendConverted } = require('../internal/api-steps.js');
const { channelFailure, InvalidMessageError } = require('../internal/channel/failure.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { generateId } = require('../core/id.js');
const { toUuid } = require('../internal/uuid.js');
const { verifyByGet } = require('../internal/verify.js');
const { createGoogleChatConfig } = require('./config.js');
const { createGoogleChatClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

const PROVIDER = 'google-chat';

const receiptOf = (answer) => {
  const name = answer.json?.name;
  if (typeof name !== 'string' || name === '') {
    return createFailedReceipt('Google Chat answered without the name of the message.', {
      provider: PROVIDER,
      channel: PROVIDER,
      category: 'unknown',
      deliveryUnknown: true,
    });
  }
  return {
    successful: true,
    messageId: name,
    provider: PROVIDER,
    channel: PROVIDER,
    state: 'sent',
  };
};

/**
 * A transport of messages of Google Chat, through the webhook of a space or
 * a Chat app.
 */
class GoogleChatTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createGoogleChatConfig, createGoogleChatClient);
  }

  /**
   * Posts one message.
   *
   * @param message A message of Google Chat.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the `name` of the message its id.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: PROVIDER,
      convert: (sentMessage) => {
        const converted = convertMessage(sentMessage);
        if (converted.toWebhook && this.config.webhookUrl === undefined) {
          throw new InvalidMessageError(
            'Google Chat: a message without `to` goes to the webhook, and the transport has no webhookUrl.',
          );
        }
        if (!converted.toWebhook && this.config.serviceAccount === undefined) {
          throw new InvalidMessageError(
            'Google Chat: a message to a space goes through a Chat app, and the transport has no serviceAccount.',
          );
        }
        converted.space = sentMessage.to;
        // The request id of a message of the app, which the API answers again
        // with the message it made under it.
        if (!converted.toWebhook) {
          converted.requestId = toUuid(
            sentMessage.idempotencyKey ?? generateId('idempotency-key', this.config.generateId),
          );
        }
        return converted;
      },
      request: (converted, sendOptions) =>
        converted.toWebhook
          ? this.httpClient.postWebhook(converted.body, sendOptions)
          : this.httpClient.post(converted.space, converted.requestId, converted.body, sendOptions),
      receiptOf,
      failureOf: (error) => channelFailure(PROVIDER, PROVIDER, error),
    });
  }

  /**
   * Checks the account of the Chat app by listing a space it is in.  A
   * webhook cannot be checked without posting to it: a transport of a
   * webhook alone verifies nothing.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Google refuses the account.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    if (this.config.serviceAccount === undefined) return;
    await verifyByGet(this, 'Google Chat', this.httpClient.spacesUrl, options);
  }
}

module.exports = { GoogleChatTransport };
