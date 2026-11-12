// Not ported: a transport of the messaging of Meta, WhatsApp through its
// Cloud API, Messenger and Instagram through the Send API, on one client of
// the Graph API, each channel with its number, page or account and its
// token; the receipt of the message Meta took, whose delivery its webhooks
// tell.

const { createFailedReceipt } = require('../core/receipt.js');
const { sendConverted } = require('../internal/api-steps.js');
const { channelFailure } = require('../internal/channel/failure.js');
const { ProviderTransport } = require('../internal/provider-transport.js');
const { RefusalError } = require('../internal/refusal.js');
const { verifyByGet } = require('../internal/verify.js');
const { createMetaConfig } = require('./config.js');
const { createMetaClient } = require('./http-client.js');
const { messengerBodyOf } = require('./messenger.js');
const { whatsappBodyOf } = require('./whatsapp.js');

const PROVIDER = 'meta';
const CHANNELS = new Set(['whatsapp', 'messenger', 'instagram']);

// The id of the message an answer names: `messages[0].id` of WhatsApp, the
// `message_id` of the Send API.
const idOf = (json) => {
  const fromWhatsApp = Array.isArray(json?.messages) ? json.messages[0]?.id : undefined;
  return fromWhatsApp ?? json?.message_id;
};

const receiptOf = (json, channel) => {
  const messageId = idOf(json);
  if (typeof messageId !== 'string' || messageId === '') {
    return createFailedReceipt('Meta answered without the id of the message.', {
      provider: PROVIDER,
      channel,
      category: 'unknown',
      deliveryUnknown: true,
      deliveryUnknownReason: 'no-id',
    });
  }
  // Meta tells of the delivery through its webhooks: the message is taken.
  return { successful: true, messageId, provider: PROVIDER, channel, state: 'accepted' };
};

/**
 * A transport of WhatsApp, Messenger and Instagram over the Graph API of
 * Meta.
 */
class MetaTransport extends ProviderTransport {
  constructor(config) {
    super(PROVIDER, config, createMetaConfig, createMetaClient);
  }

  /**
   * Sends one message of the channel of its block.
   *
   * @param message A message of WhatsApp, Messenger or Instagram.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, the id Meta gives the message.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    const channel = message?.channel;
    return sendConverted(message, options, {
      provider: PROVIDER,
      convert: (sent) => {
        if (!CHANNELS.has(channel)) {
          throw new RefusalError(
            `Meta: the transport sends WhatsApp, Messenger and Instagram, not ${channel ?? 'email'}.`,
          );
        }
        const block = this.config.channels[channel];
        if (block === undefined) throw new RefusalError(`Meta: the transport has no ${channel}.`);
        const body = channel === 'whatsapp' ? whatsappBodyOf(sent) : messengerBodyOf(sent);
        return { block, body };
      },
      request: (converted, sendOptions) =>
        this.httpClient.send(converted.block, converted.body, sendOptions),
      receiptOf: (answer) => receiptOf(answer.json, channel),
      failureOf: (error) =>
        channelFailure(PROVIDER, CHANNELS.has(channel) ? channel : undefined, error),
    });
  }

  /**
   * Checks the token of each channel by reading its number, page or account.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Meta refuses a token.
   */
  async verify(options) {
    for (const channel of CHANNELS) {
      const block = this.config.channels[channel];
      if (block === undefined) continue;
      await verifyByGet(this, 'Meta', this.httpClient.nodeUrl(block.id), options, {
        init: {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${block.accessToken}` },
        },
      });
    }
  }
}

module.exports = { MetaTransport };
