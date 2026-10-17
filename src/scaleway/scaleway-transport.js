// Ported from unemail v0.7.0 (src/drivers/scaleway.ts): a transport over the
// Transactional Email API of Scaleway.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: `verify` lists the domains of the project.

const { createFailedReceipt } = require('../core/receipt.js');
const { sendConcurrently } = require('../internal/batch.js');
const { isCallerAbort, providerFailure } = require('../internal/api.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { verifyByRequest } = require('../internal/verify.js');
const { createScalewayConfig } = require('./config.js');
const { createScalewayClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

/**
 * A transport over the Transactional Email API of Scaleway.
 */
class ScalewayTransport {
  id = 'scaleway';

  constructor(config) {
    this.config = createScalewayConfig(config);
    this.httpClient = createScalewayClient(this.config);
  }

  toJSON() {
    return redactSecrets(this);
  }

  [INSPECT](_depth, options, inspect) {
    return inspectRedacted(this, options, inspect);
  }

  /**
   * Sends one message with `/emails`.  Scaleway makes an email of it for each
   * recipient; the receipt has the id of the first.
   *
   * @param message The message.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt.
   * @throws The reason of the signal if it aborts.
   */
  async send(message, options) {
    options?.signal?.throwIfAborted();
    try {
      const payload = await convertMessage(message, this.config, options?.signal);
      options?.signal?.throwIfAborted();
      const answer = await this.httpClient.send(payload, options);
      const emails = answer.json?.emails;
      const messageId = Array.isArray(emails) ? emails[0]?.id : undefined;
      if (typeof messageId !== 'string' || messageId === '') {
        return createFailedReceipt('Scaleway answered without an email id.', {
          provider: 'scaleway',
          deliveryUnknown: true,
        });
      }
      return { successful: true, messageId, provider: 'scaleway' };
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      return providerFailure('scaleway', error);
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

  /**
   * Verifies the secret key by listing the domains of the project; a key
   * without that permission is verified too.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Scaleway refuses the key or cannot be reached.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    const query = `project_id=${encodeURIComponent(this.config.projectId)}&page_size=1`;
    await verifyByRequest({
      provider: 'Scaleway',
      send: (signal) =>
        this.httpClient.fetchWithAuth(
          `${this.httpClient.base}/domains?${query}`,
          { method: 'GET', headers: { Accept: 'application/json' } },
          signal,
        ),
      retries: this.config.retries,
      timeoutMs: this.config.timeout,
      signal: options?.signal,
      log: this.httpClient.log,
    });
  }
}

module.exports = { ScalewayTransport };
