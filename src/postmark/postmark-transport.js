// Ported from unemail v0.7.0 (src/drivers/postmark.ts): a transport over the
// Postmark API, single and batch sends.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Also ported from sently v1.2.2 (src/transports/postmark.ts): `verify`, the
// server of the token.
// https://github.com/omqkhafi/sently — MIT, Copyright 2026 sendx contributors
// Changed in the port: a failure in the answer of one message of a batch is
// its receipt alone, a message that cannot be converted fails alone too, and
// sently's JSON parse before the status check is gone with the shared client.

const { createFailedReceipt } = require('../core/receipt.js');
const { chunks, jsonBytes } = require('../internal/batch.js');
const {
  convertBatch,
  isCallerAbort,
  mergeBatch,
  providerFailure,
  sendConverted,
  verifyByGet,
} = require('../internal/api.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { createPostmarkConfig } = require('./config.js');
const { classifyErrorCode, createPostmarkClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

// The most messages one request of `/email/batch` takes.
const MAX_BATCH_SIZE = 500;
// Postmark takes a batch of 50 MB at most, attachments included: a batch of
// messages with files goes in as many requests as that takes, each failing,
// or of unknown delivery, on its own rather than with all 500.
const MAX_BATCH_BYTES = 50 * 1000 * 1000;

// The receipt of an answer of Postmark: an `ErrorCode` other than 0 fails it,
// though it came in a 200.
const receiptOf = (entry) => {
  if (entry == null || typeof entry !== 'object') {
    return createFailedReceipt('Postmark gave no answer for the message.', {
      provider: 'postmark',
      deliveryUnknown: true,
    });
  }
  if (entry.ErrorCode !== 0 && entry.ErrorCode !== undefined) {
    return createFailedReceipt(`Postmark: ${entry.Message ?? `ErrorCode ${entry.ErrorCode}`}`, {
      provider: 'postmark',
      ...classifyErrorCode(entry.ErrorCode),
      code: `postmark.${entry.ErrorCode}`,
      providerDetails: entry,
    });
  }
  return { successful: true, messageId: entry.MessageID, provider: 'postmark' };
};

/**
 * A transport over the API of Postmark (postmarkapp.com).
 */
class PostmarkTransport {
  id = 'postmark';

  constructor(config) {
    this.config = createPostmarkConfig(config);
    this.httpClient = createPostmarkClient(this.config);
  }

  toJSON() {
    return redactSecrets(this);
  }

  [INSPECT](_depth, options, inspect) {
    return inspectRedacted(this, options, inspect);
  }

  /**
   * Sends one message with `/email`.
   *
   * @param message The message.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt, with Postmark's MessageID.
   * @throws The reason of the signal if it aborts.
   */
  send(message, options) {
    return sendConverted(message, options, {
      provider: 'postmark',
      convert: (sent, signal) => convertMessage(sent, this.config, signal),
      request: (payload, sendOptions) => this.httpClient.send(payload, sendOptions),
      receiptOf: (answer) => receiptOf(answer.json),
    });
  }

  /**
   * Sends messages with `/email/batch`, 500 and 50 MB a request at most,
   * reading the input a batch at a time; each message has the receipt of its
   * own answer.
   *
   * @param messages The messages.
   * @param options Optional abort signal and retry callback.
   * @returns The receipts, in the order of the messages.
   */
  async *sendMany(messages, options) {
    const signal = options?.signal;
    for await (const batch of chunks(messages, MAX_BATCH_SIZE)) {
      signal?.throwIfAborted();
      const converted = await convertBatch(
        batch,
        (message) => convertMessage(message, this.config, signal),
        'postmark',
        signal,
      );
      if (converted.payloads.length === 0) {
        yield* mergeBatch(converted.slots, () => undefined);
        continue;
      }
      const receipts = [];
      let run = [];
      let bytes = 2;
      for (const payload of converted.payloads) {
        const size = jsonBytes(payload);
        if (run.length > 0 && bytes + size > MAX_BATCH_BYTES) {
          for (const receipt of await this.#sendRun(run, options)) receipts.push(receipt);
          run = [];
          bytes = 2;
        }
        run.push(payload);
        bytes += size;
      }
      for (const receipt of await this.#sendRun(run, options)) receipts.push(receipt);
      yield* mergeBatch(converted.slots, (index) => receipts[index]);
    }
  }

  // Sends the payloads of one request: a receipt each, in order.
  async #sendRun(payloads, options) {
    const receipts = [];
    try {
      const answer = await this.httpClient.sendBatch(payloads, options);
      const answers = Array.isArray(answer.json) ? answer.json : [];
      for (let i = 0; i < payloads.length; i++) receipts.push(receiptOf(answers[i]));
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      const failure = providerFailure('postmark', error);
      for (let i = 0; i < payloads.length; i++) receipts.push(failure);
    }
    return receipts;
  }

  /**
   * Verifies the server token by reading its server (`GET /server`).
   *
   * @param options Optional abort signal.
   * @throws {Error} If Postmark refuses the token or cannot be reached.
   */
  verify(options) {
    return verifyByGet(this, 'Postmark', `${this.config.baseUrl}/server`, options);
  }
}

module.exports = { PostmarkTransport };
