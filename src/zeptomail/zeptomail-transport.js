// Ported from unemail v0.7.0 (src/drivers/zeptomail.ts): a transport over the
// ZeptoMail API.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: a batch goes as concurrent single requests, not as the
// `/email/batch` of one message to many recipients, whose one answer every
// message shared.

const { sendConverted, sentWith } = require('../internal/api.js');
const { createZeptoMailConfig } = require('./config.js');
const { createZeptoMailClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');
const { ProviderTransport } = require('../internal/provider-transport.js');

/**
 * A transport over the email API of ZeptoMail.
 */
class ZeptoMailTransport extends ProviderTransport {
  constructor(config) {
    super('zeptomail', config, createZeptoMailConfig, createZeptoMailClient);
  }

  /**
   * Sends one message with `/v1.1/email`.
   *
   * @param message The message.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, with the `request_id` of the answer.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: 'zeptomail',
      convert: (sent, signal) => convertMessage(sent, this.config, signal),
      request: (payload, sendOptions) => this.httpClient.send(payload, sendOptions),
      receiptOf: (answer) =>
        sentWith('zeptomail', answer.json?.request_id, 'ZeptoMail answered without a request_id.'),
    });
  }
}

module.exports = { ZeptoMailTransport };
