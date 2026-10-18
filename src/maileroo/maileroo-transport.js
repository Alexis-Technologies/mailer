// Ported from upyo v0.7.0 (packages/maileroo/src/maileroo-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createFailedReceipt } = require('../core/receipt.js');
const { createMailerooConfig } = require('./config.js');
const { MailerooHttpClient } = require('./http-client.js');
const { isCallerAbort, providerFailure } = require('../internal/api-client.js');
const { convertMessage } = require('./message-converter.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { sendConcurrently } = require('../internal/batch.js');

/**
 * Maileroo transport implementation for sending emails via Maileroo API.
 *
 * @example
 * ```typescript
 * import { createMessage } from "@alexify/mailer";
 * import { MailerooTransport } from "@alexify/mailer/maileroo";
 *
 * const transport = new MailerooTransport({
 *   apiKey: "your-sending-key",
 * });
 *
 * const receipt = await transport.send(createMessage({
 *   from: "sender@example.com",
 *   to: "recipient@example.com",
 *   subject: "Hello from Maileroo",
 *   content: { text: "Hello!" },
 * }));
 * ```
 */
class MailerooTransport {
  id = 'maileroo';

  /**
   * The resolved Maileroo configuration used by this transport.
   */
  config;

  httpClient;

  /**
   * Creates a new Maileroo transport instance.
   *
   * @param config Maileroo configuration including API key and options.
   */
  constructor(config) {
    this.config = createMailerooConfig(config);
    this.httpClient = new MailerooHttpClient(this.config);
  }

  /**
   * Leaves the credentials of the configuration out of `JSON.stringify()`.
   *
   * @returns A plain copy of the transport with its credentials redacted.
   */
  toJSON() {
    return redactSecrets(this);
  }

  /**
   * Leaves the credentials of the configuration out of `util.inspect()`, and
   * so out of `console.log()` and of loggers that inspect what they log.
   */
  [INSPECT](_depth, options, inspect) {
    return inspectRedacted(this, options, inspect);
  }

  /**
   * Sends a single email message via Maileroo API.
   *
   * @param message The email message to send.
   * @param options Optional transport options including `AbortSignal`.
   * @returns A receipt indicating success or failure.
   * @throws {Error} If the caller aborts the operation.
   */
  async send(message, options) {
    try {
      options?.signal?.throwIfAborted();

      const emailData = await convertMessage(message, this.config, options?.signal);

      options?.signal?.throwIfAborted();

      const response = await this.httpClient.sendMessage(
        emailData,
        options?.signal,
        options?.onRetry,
      );

      return responseToReceipt(response);
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      return providerFailure('maileroo', error);
    }
  }

  /**
   * Sends multiple email messages sequentially via Maileroo API.
   *
   * @param messages An iterable or async iterable of messages to send.
   * @param options Optional transport options including `AbortSignal`.
   * @returns An async iterable of receipts, one for each message.
   */
  async *sendMany(messages, options) {
    options?.signal?.throwIfAborted();
    yield* sendConcurrently(
      messages,
      this.config.concurrency,
      (message) => this.send(message, options),
      options?.signal,
    );
  }
}

const responseToReceipt = (response) => {
  if (!response.success) {
    return createFailedReceipt(response.message ?? 'Maileroo reported an unsuccessful response.', {
      provider: 'maileroo',
      category: 'rejected',
      code: 'maileroo.unsuccessful',
      retryable: false,
      providerDetails: response,
    });
  }

  const messageId = response.data?.reference_id;
  if (messageId == null || messageId === '') {
    return createFailedReceipt('Maileroo response is missing a reference ID.', {
      provider: 'maileroo',
      category: 'unknown',
      code: 'maileroo.missing_reference_id',
      retryable: false,
      providerDetails: response,
    });
  }

  return {
    successful: true,
    messageId,
    provider: 'maileroo',
  };
};

module.exports = { MailerooTransport };
