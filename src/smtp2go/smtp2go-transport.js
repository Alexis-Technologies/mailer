// Ported from unemail v0.7.0 (src/drivers/smtp2go.ts): a transport over the
// SMTP2GO API, which answers 200 to a send that failed.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: the id of a receipt is the `email_id`, which the
// events name, before the `schedule_id`; and `verify` reads the summary of
// the account.

const { createFailedReceipt } = require('../core/receipt.js');
const { sendConverted, sendManyConcurrently, verifyByGet } = require('../internal/api.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { createSmtp2goConfig } = require('./config.js');
const { createSmtp2goClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

const describeFailure = (failure) => {
  if (typeof failure === 'string') return failure;
  return JSON.stringify(failure);
};

// "this endpoint returns 200 OK even if there are errors in the response":
// the outcome is in `failed` and `failures`, which count messages, not
// recipients.
const receiptOf = (json) => {
  const data = json?.data ?? {};
  const failures = Array.isArray(data.failures) ? data.failures : [];
  if (data.failed > 0 || failures.length > 0) {
    let reason = '';
    for (const failure of failures) {
      reason += reason === '' ? describeFailure(failure) : `; ${describeFailure(failure)}`;
    }
    return createFailedReceipt(`SMTP2GO: ${reason === '' ? 'the message failed.' : reason}`, {
      provider: 'smtp2go',
      category: 'rejected',
      retryable: false,
      code: 'smtp2go.failed',
      providerDetails: data,
    });
  }
  const messageId = data.email_id || data.schedule_id;
  if (typeof messageId !== 'string' || messageId === '') {
    return createFailedReceipt('SMTP2GO answered without an email_id.', {
      provider: 'smtp2go',
      deliveryUnknown: true,
    });
  }
  return { successful: true, messageId, provider: 'smtp2go' };
};

/**
 * A transport over the email API of SMTP2GO.
 */
class Smtp2goTransport {
  id = 'smtp2go';

  constructor(config) {
    this.config = createSmtp2goConfig(config);
    this.httpClient = createSmtp2goClient(this.config);
  }

  toJSON() {
    return redactSecrets(this);
  }

  [INSPECT](_depth, options, inspect) {
    return inspectRedacted(this, options, inspect);
  }

  /**
   * Sends one message with `/v3/email/send`.
   *
   * @param message The message.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, with the `email_id` of the answer.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: 'smtp2go',
      convert: (sent, signal) => convertMessage(sent, this.config, signal),
      request: (payload, sendOptions) => this.httpClient.send(payload, sendOptions),
      receiptOf: (answer) => receiptOf(answer.json),
    });
  }

  /**
   * Sends messages `concurrency` at a time, the receipts in their order.
   */
  sendMany(messages, options) {
    return sendManyConcurrently(this, messages, options);
  }

  /**
   * Verifies the API key by reading the summary of the account
   * (`POST /v3/stats/email_summary`); a key without that permission is
   * verified too.
   *
   * @param options Optional abort signal.
   * @throws {Error} If SMTP2GO refuses the key or cannot be reached.
   */
  verify(options) {
    return verifyByGet(this, 'SMTP2GO', `${this.config.baseUrl}/v3/stats/email_summary`, options, {
      init: {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: '{}',
      },
      // SMTP2GO answers a key that may not read the summary with a 400.
      check: (status, text) => status === 400 && text.includes('ENDPOINT_PERMISSION_DENIED'),
    });
  }
}

module.exports = { Smtp2goTransport };
