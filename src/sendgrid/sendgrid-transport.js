// Ported from upyo v0.7.0 (packages/sendgrid/src/sendgrid-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { generateId } = require('../core/id.js');
const { createSendGridConfig } = require('./config.js');
const { verifyByRequest } = require('../internal/verify.js');
const { SendGridHttpClient } = require('./http-client.js');
const { isCallerAbort, providerFailure } = require('../internal/api-client.js');
const { convertMessage } = require('./message-converter.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { sendConcurrently } = require('../internal/batch.js');

/**
 * SendGrid transport implementation for sending emails via SendGrid API.
 *
 * This transport provides efficient email delivery using SendGrid's v3 HTTP API,
 * with support for authentication, retry logic, and batch sending capabilities.
 *
 * @example
 * ```typescript
 * import { SendGridTransport } from '@alexify/mailer/sendgrid';
 *
 * const transport = new SendGridTransport({
 *   apiKey: 'your-sendgrid-api-key',
 *   clickTracking: true,
 *   openTracking: true
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
class SendGridTransport {
  id = 'sendgrid';

  /**
   * The resolved SendGrid configuration used by this transport.
   */
  config;

  httpClient;

  /**
   * Creates a new SendGrid transport instance.
   *
   * @param config SendGrid configuration including API key and options.
   */
  constructor(config) {
    this.config = createSendGridConfig(config);
    this.httpClient = new SendGridHttpClient(this.config);
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
   * Verifies the API key with the scopes it has (`GET /v3/scopes`), and that
   * one of them is `mail.send`.
   *
   * @param options Optional abort signal.
   * @throws {Error} If SendGrid refuses the key, or the key may not send.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    await verifyByRequest({
      provider: 'SendGrid',
      send: (signal) =>
        this.httpClient.fetchWithAuth(`${this.config.baseUrl}/scopes`, { method: 'GET' }, signal),
      check: (status, body) => {
        if (status < 200 || status > 299) return false;
        let scopes;
        try {
          scopes = JSON.parse(body).scopes;
        } catch {
          scopes = undefined;
        }
        if (!Array.isArray(scopes) || !scopes.includes('mail.send')) {
          throw new Error('The SendGrid API key has no mail.send scope, so it may not send mail.');
        }
        return true;
      },
      retries: this.config.retries,
      timeoutMs: this.config.timeout,
      signal: options?.signal,
      log: this.httpClient.log,
    });
  }

  /**
   * Sends a single email message via SendGrid API.
   *
   * This method converts the message to SendGrid format, makes an HTTP request
   * to the SendGrid API, and returns a receipt with the result.
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
    options?.signal?.throwIfAborted();

    try {
      const mailData = await convertMessage(message, this.config, options?.signal);

      options?.signal?.throwIfAborted();

      const response = await this.httpClient.sendMessage(
        mailData,
        options?.signal,
        options?.onRetry,
      );

      // SendGrid returns 202 for successful sends, but doesn't provide a message ID
      // in the response body. We'll generate a synthetic ID based on the response.
      const messageId = this.extractMessageId(response);

      return {
        successful: true,
        messageId,
        provider: 'sendgrid',
      };
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) {
        throw error;
      }
      return providerFailure('sendgrid', error);
    }
  }

  /**
   * Sends multiple email messages efficiently via SendGrid API.
   *
   * This method sends each message individually but provides a streamlined
   * interface for processing multiple messages. Each message is sent as a
   * separate API request to SendGrid.
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
   * Extracts or generates a message ID from the SendGrid response.
   *
   * SendGrid doesn't return a message ID in the response body for successful sends,
   * so we generate a synthetic ID based on timestamp and some response data.
   *
   * @param response The SendGrid API response.
   * @returns A message ID string.
   */
  extractMessageId(response) {
    // Check if there's an X-Message-Id header (SendGrid sometimes provides this)
    const messageIdHeader =
      response.headers?.['x-message-id'] || response.headers?.['X-Message-Id'];

    if (messageIdHeader) {
      return messageIdHeader;
    }

    // A synthetic message ID, under a prefix that tells it from SendGrid's.
    return `sendgrid-${generateId('receipt-id', this.config.generateId)}`;
  }
}

module.exports = { SendGridTransport };
