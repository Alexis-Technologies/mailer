// Ported from unemail v0.7.0 (src/drivers/mailersend.ts): a transport over the
// MailerSend API, whose message id is a header of its answer.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Also ported from sently v1.2.2 (src/transports/mailersend.ts): `verify`.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: a batch goes as concurrent single requests, not
// through the bulk API, which answers with one id for the whole batch and
// accepts what may fail later, unknown to the receipts.

const { sendConverted, sentWith } = require('../internal/api.js');
const { verifyByGet } = require('../internal/verify.js');
const { createMailerSendConfig } = require('./config.js');
const { createMailerSendClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');
const { ProviderTransport } = require('../internal/provider-transport.js');

/**
 * A transport over the email API of MailerSend.
 */
class MailerSendTransport extends ProviderTransport {
  constructor(config) {
    super('mailersend', config, createMailerSendConfig, createMailerSendClient);
  }

  /**
   * Sends one message with `/v1/email`.
   *
   * @param message The message.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, with the `X-Message-Id` of the answer.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: 'mailersend',
      convert: (sent, signal) => convertMessage(sent, this.config, signal),
      request: (payload, sendOptions) => this.httpClient.send(payload, sendOptions),
      receiptOf: (answer) =>
        sentWith(
          'mailersend',
          answer.headers.get('x-message-id') ?? answer.json?.message_id,
          'MailerSend answered without an X-Message-Id.',
        ),
    });
  }

  /**
   * Verifies the API token by reading the domains of the account
   * (`GET /v1/domains`); a token without that scope is verified too.
   *
   * @param options Optional abort signal.
   * @throws {Error} If MailerSend refuses the token or cannot be reached.
   */
  verify(options) {
    // A token without the access of domains is refused it with a 403.
    return verifyByGet(this, 'MailerSend', `${this.config.baseUrl}/v1/domains`, options, {
      acceptForbidden: true,
    });
  }
}

module.exports = { MailerSendTransport };
