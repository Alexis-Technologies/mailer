// Ported from unemail v0.7.0 (src/drivers/scaleway.ts): a transport over the
// Transactional Email API of Scaleway.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: `verify` lists the domains of the project.

const { sendConverted, sentWith } = require('../internal/api.js');
const { sendManyConcurrently } = require('../internal/batch.js');
const { verifyByGet } = require('../internal/verify.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
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
  send(message, options) {
    return sendConverted(message, options, {
      provider: 'scaleway',
      convert: (sent, signal) => convertMessage(sent, this.config, signal),
      request: (payload, sendOptions) => this.httpClient.send(payload, sendOptions),
      receiptOf: (answer) =>
        sentWith(
          'scaleway',
          answer.json?.emails?.[0]?.id,
          'Scaleway answered without an email id.',
        ),
    });
  }

  /**
   * Sends messages `concurrency` at a time, the receipts in their order.
   */
  sendMany(messages, options) {
    return sendManyConcurrently(this, messages, options);
  }

  /**
   * Verifies the secret key by listing the domains of the project; a key
   * without that permission is verified too.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Scaleway refuses the key or cannot be reached.
   */
  verify(options) {
    const query = `project_id=${encodeURIComponent(this.config.projectId)}&page_size=1`;
    // A key whose policy may send but not read the domains is refused with a 403.
    return verifyByGet(this, 'Scaleway', `${this.httpClient.base}/domains?${query}`, options, {
      acceptForbidden: true,
    });
  }
}

module.exports = { ScalewayTransport };
