// Ported from unemail v0.7.0 (src/drivers/brevo.ts): a transport over the
// Brevo API.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Also ported from sently v1.2.2 (src/transports/brevo.ts): `verify`, the
// account of the key.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: a batch goes as concurrent single requests, each with
// its idempotency key, rather than as the `messageVersions` of one request,
// whose grouping unemail took by file name and length of the attachments, so
// one recipient could get another's file; and a repeated idempotency key is a
// delivery already made, not a failure to retry.

const { createFailedReceipt } = require('../core/receipt.js');
const { providerFailure, sendConverted, sentWith } = require('../internal/api.js');
const { sendManyConcurrently } = require('../internal/batch.js');
const { verifyByGet } = require('../internal/verify.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { createBrevoConfig } = require('./config.js');
const { createBrevoClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

const failureOf = (error) => {
  if (error?.receiptCode === 'brevo.duplicate_parameter') {
    // Brevo took a request with this key before: the message went then.
    return createFailedReceipt(
      'Brevo already took a message with this idempotency key; it is not sent again.',
      { provider: 'brevo', deliveryUnknown: true, code: 'brevo.duplicate_parameter' },
    );
  }
  return providerFailure('brevo', error);
};

/**
 * A transport over the transactional email API of Brevo (formerly
 * Sendinblue).
 */
class BrevoTransport {
  id = 'brevo';

  constructor(config) {
    this.config = createBrevoConfig(config);
    this.httpClient = createBrevoClient(this.config);
  }

  toJSON() {
    return redactSecrets(this);
  }

  [INSPECT](_depth, options, inspect) {
    return inspectRedacted(this, options, inspect);
  }

  /**
   * Sends one message with `/v3/smtp/email`.
   *
   * @param message The message.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, with Brevo's messageId.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: 'brevo',
      convert: (sent, signal) => convertMessage(sent, this.config, signal),
      request: (payload, sendOptions) => this.httpClient.send(payload, sendOptions),
      receiptOf: (answer) =>
        sentWith(
          'brevo',
          answer.json?.messageId ?? answer.json?.messageIds?.[0],
          'Brevo answered without a messageId.',
        ),
      failureOf,
    });
  }

  /**
   * Sends messages `concurrency` at a time, the receipts in their order.
   */
  sendMany(messages, options) {
    return sendManyConcurrently(this, messages, options);
  }

  /**
   * Verifies the API key by reading its account (`GET /v3/account`).
   *
   * @param options Optional abort signal.
   * @throws {Error} If Brevo refuses the key or cannot be reached.
   */
  verify(options) {
    return verifyByGet(this, 'Brevo', `${this.config.baseUrl}/v3/account`, options);
  }
}

module.exports = { BrevoTransport };
