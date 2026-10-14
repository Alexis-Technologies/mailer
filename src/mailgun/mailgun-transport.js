// Ported from upyo v0.7.0 (packages/mailgun/src/mailgun-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createFailedReceipt } = require('../core/receipt.js');
const { createMailgunConfig } = require('./config.js');
const { MailgunApiError, MailgunHttpClient } = require('./http-client.js');
const { convertMessage } = require('./message-converter.js');

/**
 * Mailgun transport implementation for sending emails via Mailgun API.
 *
 * This transport provides efficient email delivery using Mailgun's HTTP API,
 * with support for authentication, retry logic, and batch sending capabilities.
 *
 * @example
 * ```typescript
 * import { MailgunTransport } from '@alexify/mailer/mailgun';
 *
 * const transport = new MailgunTransport({
 *   apiKey: 'your-api-key',
 *   domain: 'your-domain.com',
 *   region: 'us' // or 'eu'
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
class MailgunTransport {
  id = 'mailgun';

  /**
   * The resolved Mailgun configuration used by this transport.
   */
  config;

  httpClient;

  /**
   * Creates a new Mailgun transport instance.
   *
   * @param config Mailgun configuration including API key, domain, and options.
   */
  constructor(config) {
    this.config = createMailgunConfig(config);
    this.httpClient = new MailgunHttpClient(this.config);
  }

  /**
   * Sends a single email message via Mailgun API.
   *
   * This method converts the message to Mailgun format, makes an HTTP request
   * to the Mailgun API, and returns a receipt with the result.
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
    options?.signal?.throwIfAborted();

    try {
      const formData = await convertMessage(message, this.config, options?.signal);

      options?.signal?.throwIfAborted();

      const response = await this.httpClient.sendMessage(formData, options?.signal);

      return {
        successful: true,
        messageId: response.id,
        provider: 'mailgun',
      };
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      return createMailgunFailure(errorMessage, error);
    }
  }

  /**
   * Sends multiple email messages efficiently via Mailgun API.
   *
   * This method sends each message individually but provides a streamlined
   * interface for processing multiple messages. Each message is sent as a
   * separate API request to Mailgun.
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

    if (isAsyncIterable) {
      for await (const message of messages) {
        options?.signal?.throwIfAborted();
        yield await this.send(message, options);
      }
    } else {
      for (const message of messages) {
        options?.signal?.throwIfAborted();
        yield await this.send(message, options);
      }
    }
  }
}

const createMailgunFailure = (message, error) => {
  if (error instanceof MailgunApiError) {
    return createFailedReceipt(message, {
      provider: 'mailgun',
      statusCode: error.statusCode,
      retryAfterMilliseconds: error.retryAfterMilliseconds,
      attempts: error.attempts,
    });
  }

  return createFailedReceipt(message, {
    provider: 'mailgun',
  });
};

const isCallerAbort = (error, signal) => {
  return signal?.aborted === true && (isAbortError(error) || error === signal.reason);
};

const isAbortError = (error) => {
  return error instanceof Error && error.name === 'AbortError';
};

module.exports = { MailgunTransport };
