// Ported from upyo v0.7.0 (packages/plunk/src/plunk-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { generateId } = require('../core/id.js');
const { createFailedReceipt } = require('../core/receipt.js');
const { createPlunkConfig } = require('./config.js');
const { PlunkApiError, PlunkHttpClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { isDeliveryUnknown } = require('../internal/delivery-unknown.js');
const { sendConcurrently } = require('../internal/batch.js');
const { certificateFailure } = require('../internal/refusal.js');

/**
 * Plunk transport implementation for sending emails via Plunk API.
 *
 * This transport provides efficient email delivery using Plunk's HTTP API,
 * with support for both cloud-hosted and self-hosted instances, authentication,
 * retry logic, and batch sending capabilities.
 *
 * @example
 * ```typescript
 * import { PlunkTransport } from '@alexify/mailer/plunk';
 *
 * const transport = new PlunkTransport({
 *   apiKey: 'your-plunk-api-key',
 *   baseUrl: 'https://next-api.useplunk.com', // or self-hosted URL
 *   timeout: 30000,
 *   retries: 3
 * });
 *
 * const receipt = await transport.send(message);
 * if (receipt.successful) {
 *   console.log('Message sent with ID:', receipt.messageId);
 * } else {
 *   console.error('Send failed:', receipt.errorMessages.join(', '));
 * }
 * ```
 */
class PlunkTransport {
  id = 'plunk';

  /**
   * The resolved Plunk configuration used by this transport.
   */
  config;

  httpClient;

  /**
   * Creates a new Plunk transport instance.
   *
   * @param config Plunk configuration including API key and options.
   */
  constructor(config) {
    this.config = createPlunkConfig(config);
    this.httpClient = new PlunkHttpClient(this.config);
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
   * Sends a single email message via Plunk API.
   *
   * This method converts the message to Plunk format, makes an HTTP request
   * to the Plunk API, and returns a receipt with the result.
   *
   * @example
   * ```typescript
   * const receipt = await transport.send({
   *   sender: { address: 'from@example.com' },
   *   recipients: [{ address: 'to@example.com' }],
   *   ccRecipients: [],
   *   bccRecipients: [],
   *   replyRecipients: [],
   *   subject: 'Hello',
   *   content: { text: 'Hello World!' },
   *   attachments: [],
   *   priority: 'normal',
   *   tags: [],
   *   headers: new Headers()
   * });
   *
   * if (receipt.successful) {
   *   console.log('Message sent successfully');
   * }
   * ```
   *
   * @param message The email message to send.
   * @param options Optional transport options including `AbortSignal` for
   *                cancellation.
   * @returns A promise that resolves to a receipt indicating success or
   *          failure.
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

      // Extract message ID from response
      const messageId = this.extractMessageId(response, message);

      return {
        successful: true,
        messageId,
        provider: 'plunk',
      };
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      return createPlunkFailure(errorMessage, error);
    }
  }

  /**
   * Sends multiple email messages efficiently via Plunk API.
   *
   * This method sends each message individually but provides a streamlined
   * interface for processing multiple messages. Each message is sent as a
   * separate API request to Plunk.
   *
   * @example
   * ```typescript
   * const messages = [
   *   {
   *     sender: { address: 'from@example.com' },
   *     recipients: [{ address: 'user1@example.com' }],
   *     ccRecipients: [],
   *     bccRecipients: [],
   *     replyRecipients: [],
   *     subject: 'Message 1',
   *     content: { text: 'Hello User 1!' },
   *     attachments: [],
   *     priority: 'normal',
   *     tags: [],
   *     headers: new Headers()
   *   },
   *   {
   *     sender: { address: 'from@example.com' },
   *     recipients: [{ address: 'user2@example.com' }],
   *     ccRecipients: [],
   *     bccRecipients: [],
   *     replyRecipients: [],
   *     subject: 'Message 2',
   *     content: { text: 'Hello User 2!' },
   *     attachments: [],
   *     priority: 'normal',
   *     tags: [],
   *     headers: new Headers()
   *   }
   * ];
   *
   * for await (const receipt of transport.sendMany(messages)) {
   *   if (receipt.successful) {
   *     console.log('Sent:', receipt.messageId);
   *   } else {
   *     console.error('Failed:', receipt.errorMessages);
   *   }
   * }
   * ```
   *
   * @param messages An iterable or async iterable of messages to send.
   * @param options Optional transport options including `AbortSignal` for
   *                cancellation.
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

  /**
   * Extracts or generates a message ID from the Plunk response.
   *
   * Plunk returns its email record ID in the response. This ID can be used to
   * correlate the send operation with webhook events.
   *
   * @param response The Plunk API response.
   * @param message The original message for fallback ID generation.
   * @returns A message ID string.
   */
  extractMessageId(response, _message) {
    const emailId = response.emails?.[0]?.email;
    if (emailId) {
      return emailId;
    }

    // Fallback: generate synthetic message ID.  Upstream put the first eight
    // characters of the recipient's local part into it, personal data that
    // receipts carry into logs.
    return `plunk-${generateId('receipt-id', this.config.generateId)}`;
  }
}

const createPlunkFailure = (message, error) => {
  const certificate = certificateFailure('plunk', message, error);
  if (certificate !== undefined) return certificate;
  if (error instanceof PlunkApiError) {
    return createFailedReceipt(message, {
      deliveryUnknown: isDeliveryUnknown(error),
      provider: 'plunk',
      statusCode: error.statusCode,
      retryAfterMilliseconds: error.retryAfterMilliseconds,
      attempts: error.attempts,
    });
  }

  return createFailedReceipt(message, {
    deliveryUnknown: isDeliveryUnknown(error),
    provider: 'plunk',
  });
};

const isAbortError = (error) => {
  return error instanceof Error && error.name === 'AbortError';
};

const isCallerAbort = (error, signal) => {
  return signal?.aborted === true && (isAbortError(error) || error === signal.reason);
};

module.exports = { PlunkTransport };
