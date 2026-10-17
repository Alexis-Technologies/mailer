// Ported from unemail v0.7.0 (src/drivers/zeptomail.ts): a transport over the
// ZeptoMail API.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: a batch goes as concurrent single requests, not as the
// `/email/batch` of one message to many recipients, whose one answer every
// message shared.

const { createFailedReceipt } = require('../core/receipt.js');
const { sendConcurrently } = require('../internal/batch.js');
const { isCallerAbort, providerFailure } = require('../internal/api.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { createZeptoMailConfig } = require('./config.js');
const { createZeptoMailClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

/**
 * A transport over the email API of ZeptoMail.
 */
class ZeptoMailTransport {
  id = 'zeptomail';

  constructor(config) {
    this.config = createZeptoMailConfig(config);
    this.httpClient = createZeptoMailClient(this.config);
  }

  toJSON() {
    return redactSecrets(this);
  }

  [INSPECT](_depth, options, inspect) {
    return inspectRedacted(this, options, inspect);
  }

  /**
   * Sends one message with `/v1.1/email`.
   *
   * @param message The message.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, with the `request_id` of the answer.
   * @throws The reason of the signal if it aborts.
   */
  async send(message, options) {
    options?.signal?.throwIfAborted();
    try {
      const payload = await convertMessage(message, this.config, options?.signal);
      options?.signal?.throwIfAborted();
      const answer = await this.httpClient.send(payload, options);
      const messageId = answer.json?.request_id;
      if (typeof messageId !== 'string' || messageId === '') {
        return createFailedReceipt('ZeptoMail answered without a request_id.', {
          provider: 'zeptomail',
          deliveryUnknown: true,
        });
      }
      return { successful: true, messageId, provider: 'zeptomail' };
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      return providerFailure('zeptomail', error);
    }
  }

  /**
   * Sends messages `concurrency` at a time, the receipts in their order.
   */
  sendMany(messages, options) {
    return sendConcurrently(
      messages,
      this.config.concurrency,
      (message) => this.send(message, options),
      options?.signal,
    );
  }
}

module.exports = { ZeptoMailTransport };
