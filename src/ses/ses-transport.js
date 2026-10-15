// Ported from upyo v0.7.0 (packages/ses/src/ses-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createFailedReceipt } = require('../core/receipt.js');
const { createSesConfig } = require('./config.js');
const { SesApiError, SesHttpClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');

/**
 * Amazon SES email transport implementation.
 *
 * This transport sends emails through the AWS Simple Email Service (SES) using
 * the v2 API.  It supports AWS Signature v4 authentication, configurable
 * retries, and concurrent batch sending.
 *
 * @example
 * ```typescript
 * import { SesTransport } from "@alexify/mailer/ses";
 * import { createMessage } from "@alexify/mailer";
 *
 * const transport = new SesTransport({
 *   authentication: {
 *     type: "credentials",
 *     accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 *   },
 *   region: "us-east-1",
 * });
 *
 * const message = createMessage({
 *   from: "sender@example.com",
 *   to: "recipient@example.com",
 *   subject: "Hello from SES",
 *   content: { text: "This is a test message" },
 * });
 *
 * const receipt = await transport.send(message);
 * if (receipt.successful) {
 *   console.log("Email sent with ID:", receipt.messageId);
 * }
 * ```
 */
class SesTransport {
  id = 'ses';

  /** Resolved configuration with defaults applied */
  config;

  /** HTTP client for SES API requests */
  httpClient;

  /**
   * Creates a new SES transport instance.
   *
   * @param config SES configuration options.
   */
  constructor(config) {
    this.config = createSesConfig(config);
    this.httpClient = new SesHttpClient(this.config);
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
   * Sends a single email message through Amazon SES.
   *
   * This method converts the message to SES format, sends it via the SES v2 API,
   * and returns a receipt indicating success or failure.
   *
   * @example
   * ```typescript
   * const message = createMessage({
   *   from: "sender@example.com",
   *   to: "recipient@example.com",
   *   subject: "Hello",
   *   content: { text: "Hello, world!" },
   *   attachments: [{
   *     filename: "document.pdf",
   *     content: Promise.resolve(pdfBytes),
   *     contentType: "application/pdf",
   *   }],
   * });
   *
   * const receipt = await transport.send(message);
   * ```
   *
   * @param message The email message to send.
   * @param options Optional transport options (e.g., abort signal).
   * @returns A promise that resolves to a receipt with the result.
   */
  async send(message, options) {
    options?.signal?.throwIfAborted();

    try {
      const sesMessage = await convertMessage(message, this.config, options?.signal);

      options?.signal?.throwIfAborted();

      const response = await this.httpClient.sendMessage(sesMessage, options?.signal);

      const messageId = this.extractMessageId(response);

      return {
        successful: true,
        messageId,
        provider: 'ses',
      };
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      return createSesFailure(errorMessage, error);
    }
  }

  /**
   * Sends multiple email messages concurrently through Amazon SES.
   *
   * This method processes messages in batches (configurable via `batchSize`)
   * and sends each batch concurrently to improve performance. It yields
   * receipts as they become available, allowing for streaming processing of
   * results.
   *
   * @example
   * ```typescript
   * const messages = [
   *   createMessage({ from: "sender@example.com", to: "user1@example.com", subject: "Hello 1", content: { text: "Message 1" } }),
   *   createMessage({ from: "sender@example.com", to: "user2@example.com", subject: "Hello 2", content: { text: "Message 2" } }),
   *   createMessage({ from: "sender@example.com", to: "user3@example.com", subject: "Hello 3", content: { text: "Message 3" } }),
   * ];
   *
   * for await (const receipt of transport.sendMany(messages)) {
   *   if (receipt.successful) {
   *     console.log("Sent:", receipt.messageId);
   *   } else {
   *     console.error("Failed:", receipt.errorMessages);
   *   }
   * }
   * ```
   *
   * @param messages An iterable or async iterable of messages to send.
   * @param options Optional transport options (e.g., abort signal).
   * @returns Individual receipts for each message as they complete.
   */
  async *sendMany(messages, options) {
    options?.signal?.throwIfAborted();

    const isAsyncIterable = Symbol.asyncIterator in messages;
    const messageArray = [];

    if (isAsyncIterable) {
      for await (const message of messages) {
        messageArray.push(message);
      }
    } else {
      for (const message of messages) {
        messageArray.push(message);
      }
    }

    const batchSize = this.config.batchSize;

    for (let i = 0; i < messageArray.length; i += batchSize) {
      options?.signal?.throwIfAborted();

      const batch = messageArray.slice(i, i + batchSize);

      const receipts = await this.sendConcurrent(batch, options);
      for (const receipt of receipts) {
        yield receipt;
      }
    }
  }

  async sendConcurrent(messages, options) {
    options?.signal?.throwIfAborted();

    const sendPromises = messages.map((message) => this.send(message, options));

    return await Promise.all(sendPromises);
  }

  extractMessageId(response) {
    if (response.body) {
      try {
        const parsed = JSON.parse(response.body);
        if (parsed.MessageId) {
          return parsed.MessageId;
        }
      } catch {
        // Ignore JSON parsing errors
      }
    }

    const messageIdHeader =
      response.headers?.['x-amzn-requestid'] || response.headers?.['X-Amzn-RequestId'];

    if (messageIdHeader) {
      return messageIdHeader;
    }

    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);

    return `ses-${timestamp}-${random}`;
  }
}

const createSesFailure = (message, error) => {
  if (error instanceof SesApiError) {
    return createFailedReceipt(message, {
      provider: 'ses',
      statusCode: error.statusCode,
      retryAfterMilliseconds: error.retryAfterMilliseconds,
      providerDetails: error.errors,
      attempts: error.attempts,
    });
  }

  return createFailedReceipt(message, {
    provider: 'ses',
  });
};

const isCallerAbort = (error, signal) => {
  return signal?.aborted === true && (isAbortError(error) || error === signal.reason);
};

const isAbortError = (error) => {
  return error instanceof Error && error.name === 'AbortError';
};

module.exports = { SesTransport };
