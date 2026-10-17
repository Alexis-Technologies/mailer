// Ported from sently v1.2.2 (src/transports/sparkpost.ts): a transport over
// the SparkPost Transmissions API, and `verify`.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: `sendRaw` sends a ready message as `email_rfc822`; a
// batch goes as concurrent requests; and the recipients SparkPost turns away
// are counted on the receipt, or fail it when it took none.

const { createFailedReceipt } = require('../core/receipt.js');
const { sendConcurrently } = require('../internal/batch.js');
const { isCallerAbort, providerFailure } = require('../internal/api.js');
const { rawMessageFailure, readRawMessage } = require('../internal/raw.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { verifyByRequest } = require('../internal/verify.js');
const { createSparkPostConfig } = require('./config.js');
const { createSparkPostClient } = require('./http-client.js');
const { convertMessage, convertRawMessage } = require('./message-converter.js');

// The receipt of `{ results: { id, total_accepted_recipients,
// total_rejected_recipients } }`.
const receiptOf = (json) => {
  const results = json?.results;
  const accepted = results?.total_accepted_recipients;
  const rejected = results?.total_rejected_recipients;
  if (accepted === 0 && rejected > 0) {
    return createFailedReceipt('SparkPost: every recipient was rejected.', {
      provider: 'sparkpost',
      category: 'rejected',
      retryable: false,
      code: 'sparkpost.recipients_rejected',
      providerDetails: results,
    });
  }
  const messageId = results?.id;
  if (typeof messageId !== 'string' || messageId === '') {
    return createFailedReceipt('SparkPost answered without a transmission id.', {
      provider: 'sparkpost',
      deliveryUnknown: true,
    });
  }
  const receipt = { successful: true, messageId, provider: 'sparkpost' };
  if (Number.isInteger(rejected) && rejected > 0) receipt.rejectedRecipientCount = rejected;
  return receipt;
};

/**
 * A transport over the Transmissions API of SparkPost.
 */
class SparkPostTransport {
  id = 'sparkpost';

  constructor(config) {
    this.config = createSparkPostConfig(config);
    this.httpClient = createSparkPostClient(this.config);
  }

  toJSON() {
    return redactSecrets(this);
  }

  [INSPECT](_depth, options, inspect) {
    return inspectRedacted(this, options, inspect);
  }

  /**
   * Sends one message as a transmission.
   *
   * @param message The message.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, with the id of the transmission.
   * @throws The reason of the signal if it aborts.
   */
  async send(message, options) {
    options?.signal?.throwIfAborted();
    try {
      const transmission = await convertMessage(message, this.config, options?.signal);
      options?.signal?.throwIfAborted();
      return receiptOf((await this.httpClient.send(transmission, options)).json);
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      return providerFailure('sparkpost', error);
    }
  }

  /**
   * Sends a ready MIME message as `email_rfc822`, to the recipients of its
   * envelope.
   *
   * @param message The raw message; its bytes must be UTF-8.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt.
   * @throws The reason of the signal if it aborts.
   */
  async sendRaw(message, options) {
    if (message?.content instanceof Promise) message.content.catch(() => {});
    options?.signal?.throwIfAborted();
    try {
      const raw = await readRawMessage(message, options?.signal);
      const transmission = convertRawMessage(raw, this.config);
      return receiptOf((await this.httpClient.send(transmission, options)).json);
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      return rawMessageFailure('sparkpost', error) ?? providerFailure('sparkpost', error);
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
   * Verifies the API key by reading the account (`GET /api/v1/account`); a key
   * without that permission is verified too.
   *
   * @param options Optional abort signal.
   * @throws {Error} If SparkPost refuses the key or cannot be reached.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    await verifyByRequest({
      provider: 'SparkPost',
      send: (signal) =>
        this.httpClient.fetchWithAuth(
          `${this.config.baseUrl}/api/v1/account`,
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

module.exports = { SparkPostTransport };
