// Ported from upyo v0.7.0 (packages/mailtrap/src/mailtrap-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createFailedReceipt } = require('../core/receipt.js');
const { createMailtrapConfig } = require('./config.js');
const { MailtrapHttpClient } = require('./http-client.js');
const { isCallerAbort, providerFailure } = require('../internal/api-client.js');
const { convertMessage } = require('./message-converter.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');

const MAX_BATCH_SIZE = 500;

/**
 * Mailtrap transport implementation for sending emails via Mailtrap API.
 *
 * @example
 * ```typescript
 * import { createMessage } from "@alexify/mailer";
 * import { MailtrapTransport } from "@alexify/mailer/mailtrap";
 *
 * const transport = new MailtrapTransport({
 *   apiToken: "your-api-token",
 *   sandbox: true,
 *   inboxId: 12345,
 * });
 *
 * const receipt = await transport.send(createMessage({
 *   from: "sender@example.com",
 *   to: "recipient@example.com",
 *   subject: "Hello from Mailtrap",
 *   content: { text: "Hello!" },
 * }));
 * ```
 */
class MailtrapTransport {
  id = 'mailtrap';

  /**
   * The resolved Mailtrap configuration used by this transport.
   */
  config;

  httpClient;

  /**
   * Creates a new Mailtrap transport instance.
   *
   * @param config Mailtrap configuration including API token and options.
   */
  constructor(config) {
    this.config = createMailtrapConfig(config);
    this.httpClient = new MailtrapHttpClient(this.config);
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
   * Sends a single email message via Mailtrap API.
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
      return providerFailure('mailtrap', error);
    }
  }

  /**
   * Sends multiple email messages via Mailtrap batch API.
   *
   * Messages are chunked into Mailtrap's maximum batch size of 500 messages.
   *
   * @param messages An iterable or async iterable of messages to send.
   * @param options Optional transport options including `AbortSignal`.
   * @returns An async iterable of receipts, one for each message.
   */
  async *sendMany(messages, options) {
    options?.signal?.throwIfAborted();

    let chunk = [];
    for await (const message of messages) {
      options?.signal?.throwIfAborted();
      chunk.push(message);
      if (chunk.length === MAX_BATCH_SIZE) {
        yield* this.sendBatch(chunk, options);
        chunk = [];
      }
    }
    yield* this.sendBatch(chunk, options);
  }
  async *sendBatch(messages, options) {
    if (messages.length === 0) return;

    const batchData = [];
    const receipts = [];

    for (const message of messages) {
      try {
        batchData.push(await convertMessage(message, this.config, options?.signal));
        receipts.push(undefined);
      } catch (error) {
        if (isCallerAbort(error, options?.signal)) throw error;
        receipts.push(providerFailure('mailtrap', error));
      }
    }

    if (batchData.length === 0) {
      for (const receipt of receipts) {
        if (receipt !== undefined) yield receipt;
      }
      return;
    }

    try {
      options?.signal?.throwIfAborted();

      const response = await this.httpClient.sendBatch(
        batchData,
        options?.signal,
        options?.onRetry,
      );

      if (response.success === false) {
        const errorMessage = formatErrors(response.errors) ?? 'Mailtrap batch request failed.';
        for (const receipt of receipts) {
          if (receipt !== undefined) {
            yield receipt;
            continue;
          }
          yield createFailedReceipt(errorMessage, {
            provider: 'mailtrap',
            category: 'rejected',
            code: 'mailtrap.batch_failed',
            retryable: false,
            providerDetails: response,
          });
        }
        return;
      }

      const itemResponses = response.responses ?? [];
      let responseIndex = 0;

      for (const receipt of receipts) {
        if (receipt !== undefined) {
          yield receipt;
          continue;
        }

        const item = itemResponses[responseIndex++];
        yield itemResponseToReceipt(item);
      }
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      for (const receipt of receipts) {
        if (receipt !== undefined) {
          yield receipt;
          continue;
        }
        yield providerFailure('mailtrap', error);
      }
    }
  }
}

const responseToReceipt = (response) => {
  return toReceipt(response, {
    unsuccessfulMessage: 'Mailtrap reported send failure.',
    unsuccessfulCode: 'mailtrap.unsuccessful',
    missingMessageIdMessage: 'Mailtrap response is missing a message ID.',
  });
};

const itemResponseToReceipt = (response) => {
  return toReceipt(response, {
    unsuccessfulMessage: 'Mailtrap reported batch item failure.',
    unsuccessfulCode: 'mailtrap.batch_item_failed',
    missingMessageIdMessage: 'Mailtrap batch response is missing a message ID.',
  });
};

const toReceipt = (response, options) => {
  if (response?.success === false) {
    return createFailedReceipt(formatErrors(response.errors) ?? options.unsuccessfulMessage, {
      provider: 'mailtrap',
      category: 'rejected',
      code: options.unsuccessfulCode,
      retryable: false,
      providerDetails: response,
    });
  }

  const messageId = response?.message_ids?.[0];
  if (messageId == null || messageId === '') {
    return createFailedReceipt(options.missingMessageIdMessage, {
      provider: 'mailtrap',
      category: 'unknown',
      code: 'mailtrap.missing_message_id',
      retryable: false,
      providerDetails: response,
    });
  }

  return {
    successful: true,
    messageId,
    provider: 'mailtrap',
  };
};

const formatErrors = (errors) => {
  if (errors == null || errors.length === 0) return undefined;
  return errors.join('; ');
};

module.exports = { MailtrapTransport };
