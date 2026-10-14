// Ported from upyo v0.7.0 (packages/resend/src/resend-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createFailedReceipt } = require('../core/receipt.js');
const { createResendConfig } = require('./config.js');
const { ResendApiError, ResendHttpClient } = require('./http-client.js');
const {
  convertMessage,
  convertMessagesBatch,
  generateIdempotencyKey,
} = require('./message-converter.js');

/**
 * Resend transport implementation for sending emails via Resend API.
 *
 * This transport provides efficient email delivery using Resend's HTTP API,
 * with support for authentication, retry logic, batch sending capabilities,
 * and idempotency for reliable delivery.
 *
 * @example
 * ```typescript
 * import { ResendTransport } from '@alexify/mailer/resend';
 *
 * const transport = new ResendTransport({
 *   apiKey: 'your-resend-api-key',
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
class ResendTransport {
  id = 'resend';

  /**
   * The resolved Resend configuration used by this transport.
   */
  config;

  httpClient;

  /**
   * Creates a new Resend transport instance.
   *
   * @param config Resend configuration including API key and options.
   */
  constructor(config) {
    this.config = createResendConfig(config);
    this.httpClient = new ResendHttpClient(this.config);
  }

  /**
   * Sends a single email message via Resend API.
   *
   * This method converts the message to Resend format, makes an HTTP request
   * to the Resend API with automatic idempotency key generation, and returns
   * a receipt with the result.
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
   *   console.log('Message sent with ID:', receipt.messageId);
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

      // Use provided idempotency key or generate one for reliable delivery
      const idempotencyKey = message.idempotencyKey ?? generateIdempotencyKey();

      const emailData = await convertMessage(message, this.config, {
        signal: options?.signal,
      });

      options?.signal?.throwIfAborted();

      const response = await this.httpClient.sendMessage(
        emailData,
        options?.signal,
        idempotencyKey,
      );

      return {
        successful: true,
        messageId: response.id,
        provider: 'resend',
      };
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      return createResendFailure(errorMessage, error);
    }
  }

  /**
   * Sends multiple email messages efficiently via Resend API.
   *
   * This method intelligently chooses between single requests and batch API
   * based on message count and features used. For optimal performance:
   * - Uses batch API for ≤100 messages without attachments or tags
   * - Falls back to individual requests for messages with unsupported features
   * - Chunks large batches (>100) into multiple batch requests
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

    const isAsyncIterable = Symbol.asyncIterator in messages;

    // Convert to array for batch processing optimization
    const messageArray = [];

    if (isAsyncIterable) {
      for await (const message of messages) {
        options?.signal?.throwIfAborted();
        messageArray.push(message);
      }
    } else {
      for (const message of messages) {
        options?.signal?.throwIfAborted();
        messageArray.push(message);
      }
    }

    // Optimize sending strategy based on message characteristics
    yield* this.sendManyOptimized(messageArray, options);
  }

  /**
   * Optimized batch sending that chooses the best strategy based on message features.
   *
   * @param messages Array of messages to send
   * @param options Transport options
   * @returns Async iterable of receipts
   */
  async *sendManyOptimized(messages, options) {
    if (messages.length === 0) {
      return;
    }

    // Check if messages are suitable for batch API
    const canUseBatch = this.canUseBatchApi(messages);

    if (canUseBatch && messages.length <= 100) {
      // Use batch API for optimal performance
      yield* this.sendBatch(messages, options);
    } else if (canUseBatch && messages.length > 100) {
      // Chunk large batches into multiple batch requests
      const chunks = this.chunkArray(messages, 100);
      for (const chunk of chunks) {
        options?.signal?.throwIfAborted();
        yield* this.sendBatch(chunk, options);
      }
    } else {
      // Fall back to individual requests for messages with unsupported features
      for (const message of messages) {
        options?.signal?.throwIfAborted();
        yield await this.send(message, options);
      }
    }
  }

  /**
   * Sends a batch of messages using Resend's batch API.
   *
   * @param messages Array of messages (≤100)
   * @param options Transport options
   * @returns Async iterable of receipts
   */
  async *sendBatch(messages, options) {
    options?.signal?.throwIfAborted();

    try {
      // Use first message's idempotency key or generate one for reliable delivery
      const idempotencyKey = messages[0]?.idempotencyKey ?? generateIdempotencyKey();

      const batchData = await convertMessagesBatch(messages, this.config);

      options?.signal?.throwIfAborted();

      const response = await this.httpClient.sendBatch(batchData, options?.signal, idempotencyKey);

      // Yield receipt for each message
      for (const result of response.data) {
        yield {
          successful: true,
          messageId: result.id,
          provider: 'resend',
        };
      }
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      // If batch fails, yield error receipt for each message
      for (let i = 0; i < messages.length; i++) {
        yield createResendFailure(errorMessage, error);
      }
    }
  }

  /**
   * Checks if messages can use Resend's batch API.
   *
   * Batch API limitations:
   * - No attachments, and so no calendar
   * - No tags
   * - No scheduled sending
   *
   * @param messages Array of messages to check
   * @returns True if all messages are suitable for batch API
   */
  canUseBatchApi(messages) {
    return messages.every(
      (message) =>
        message.attachments.length === 0 &&
        message.tags.length === 0 &&
        // A calendar becomes an attachment during conversion, which the batch
        // API forbids, and `sendBatch()` fails a whole chunk on one conversion
        // error.  Sending these individually keeps the failure — or the success
        // — confined to the message it belongs to.
        message.calendar == null,
    );
  }

  /**
   * Splits an array into chunks of specified size.
   *
   * @param array Array to chunk
   * @param size Chunk size
   * @returns Array of chunks
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

const createResendFailure = (message, error) => {
  if (error instanceof ResendApiError) {
    return createFailedReceipt(message, {
      provider: 'resend',
      statusCode: error.statusCode,
      retryAfterMilliseconds: error.retryAfterMilliseconds,
      attempts: error.attempts,
    });
  }

  return createFailedReceipt(message, {
    provider: 'resend',
  });
};

const isAbortError = (error) => {
  return error instanceof Error && error.name === 'AbortError';
};

const isCallerAbort = (error, signal) => {
  return signal?.aborted === true && (isAbortError(error) || error === signal.reason);
};

module.exports = { ResendTransport };
