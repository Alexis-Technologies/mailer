// Ported from upyo v0.7.0 (packages/resend/src/resend-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createResendConfig } = require('./config.js');
const { verifyByRequest } = require('../internal/verify.js');
const { ResendHttpClient } = require('./http-client.js');
const { isCallerAbort, providerFailure } = require('../internal/api-client.js');
const {
  convertMessage,
  convertMessagesBatch,
  generateIdempotencyKey,
} = require('./message-converter.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { chunks } = require('../internal/batch.js');

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
// The most messages a request of the batch API takes.
const MAX_BATCH_SIZE = 100;

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
   * Verifies the API key with `GET /domains`.  A key that may only send,
   * which Resend answers with `restricted_api_key`, is verified too.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Resend refuses the key or cannot be reached.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    await verifyByRequest({
      provider: 'Resend',
      send: (signal) =>
        this.httpClient.fetchWithAuth(`${this.config.baseUrl}/domains`, { method: 'GET' }, signal),
      check: (status, body) => status === 401 && isRestrictedKey(body),
      retries: this.config.retries,
      timeoutMs: this.config.timeout,
      signal: options?.signal,
      log: this.httpClient.log,
    });
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
      const idempotencyKey =
        message.idempotencyKey ?? generateIdempotencyKey(this.config.generateId);

      const emailData = await convertMessage(message, this.config, {
        signal: options?.signal,
      });

      options?.signal?.throwIfAborted();

      const response = await this.httpClient.sendMessage(
        emailData,
        options?.signal,
        idempotencyKey,
        options?.onRetry,
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

      return providerFailure('resend', error);
    }
  }

  /**
   * Sends multiple email messages efficiently via Resend API.
   *
   * The messages are read 100 at a time, the most a batch request takes, so
   * that memory holds one chunk rather than the whole input.  A chunk whose
   * messages carry no attachments, tags or calendar goes in one batch request;
   * another is sent one message at a time.
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

    // Read as many messages as a batch request takes, and no more, before
    // sending them; each chunk goes through the batch API when all of its
    // messages can.
    for await (const chunk of chunks(messages, MAX_BATCH_SIZE)) {
      options?.signal?.throwIfAborted();
      yield* this.sendManyOptimized(chunk, options);
    }
  }

  /**
   * Optimized batch sending that chooses the best strategy based on message features.
   *
   * @param messages At most 100 messages to send
   * @param options Transport options
   * @returns Async iterable of receipts
   */
  async *sendManyOptimized(messages, options) {
    if (messages.length === 0) {
      return;
    }

    // Check if messages are suitable for batch API
    const canUseBatch = this.canUseBatchApi(messages);

    if (canUseBatch) {
      yield* this.sendBatch(messages, options);
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
      const idempotencyKey =
        messages[0]?.idempotencyKey ?? generateIdempotencyKey(this.config.generateId);

      const batchData = await convertMessagesBatch(messages, this.config);

      options?.signal?.throwIfAborted();

      const response = await this.httpClient.sendBatch(
        batchData,
        options?.signal,
        idempotencyKey,
        options?.onRetry,
      );

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

      // If batch fails, yield error receipt for each message
      for (let i = 0; i < messages.length; i++) {
        yield providerFailure('resend', error);
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
    for (const message of messages) {
      // A calendar becomes an attachment during conversion, which the batch
      // API forbids, and `sendBatch()` fails a whole chunk on one conversion
      // error.  Sending these individually keeps the failure — or the success
      // — confined to the message it belongs to.
      if (
        message.attachments.length > 0 ||
        message.tags.length > 0 ||
        message.metadata !== undefined ||
        message.calendar != null ||
        message.scheduledAt != null
      ) {
        return false;
      }
    }
    return true;
  }
}

// Resend answers a key that may only send with `restricted_api_key`.
const isRestrictedKey = (body) => {
  try {
    return JSON.parse(body).name === 'restricted_api_key';
  } catch {
    return false;
  }
};

module.exports = { ResendTransport };
