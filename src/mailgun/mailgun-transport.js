// Ported from upyo v0.7.0 (packages/mailgun/src/mailgun-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createMailgunConfig } = require('./config.js');
const { verifyByRequest } = require('../internal/verify.js');
const { MailgunHttpClient } = require('./http-client.js');
const { isCallerAbort, providerFailure } = require('../internal/api-client.js');
const { convertMessage } = require('./message-converter.js');
const { rawMessageFailure, readRawMessage } = require('../internal/raw.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { sendConcurrently } = require('../internal/batch.js');

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
   * Verifies the API key and the sending domain with `GET /v3/domains/<domain>`.
   * A key of that domain that may only send (403) is verified too; a domain
   * the account does not have fails.
   *
   * @param options Optional abort signal.
   * @throws {Error} If Mailgun refuses the key or knows no such domain.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    const url = `${this.config.baseUrl}/domains/${encodeURIComponent(this.config.domain)}`;
    await verifyByRequest({
      provider: 'Mailgun',
      // A 403 is a known key that may not read: a domain sending key is refused
      // the read of its domain.
      acceptForbidden: true,
      send: (signal) => this.httpClient.fetchWithAuth(url, { method: 'GET' }, signal),
      retries: this.config.retries,
      timeoutMs: this.config.timeout,
      signal: options?.signal,
      log: this.httpClient.log,
    });
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

      const response = await this.httpClient.sendMessage(
        formData,
        options?.signal,
        options?.onRetry,
      );

      return {
        successful: true,
        messageId: response.id,
        provider: 'mailgun',
      };
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) {
        throw error;
      }
      return providerFailure('mailgun', error);
    }
  }

  /**
   * Sends serialized MIME through the `messages.mime` endpoint, to the
   * recipients of its envelope.  The message is checked as SMTP checks it
   * and read into memory; composition is bypassed.
   *
   * @param message The serialized message and its envelope.
   * @param options Optional abort signal and retry callback.
   * @returns The receipt.
   */
  async sendRaw(message, options) {
    if (message?.content instanceof Promise) message.content.catch(() => {});
    options?.signal?.throwIfAborted();
    try {
      const raw = await readRawMessage(message, options?.signal);
      const formData = new FormData();
      for (const address of raw.envelope.to) formData.append('to', address);
      formData.append('message', new Blob([raw.bytes], { type: 'message/rfc822' }), 'message.mime');
      const response = await this.httpClient.sendMime(formData, options?.signal, options?.onRetry);
      return { successful: true, messageId: response.id, provider: 'mailgun' };
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      return rawMessageFailure('mailgun', error) ?? providerFailure('mailgun', error);
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
    yield* sendConcurrently(
      messages,
      this.config.concurrency,
      (message) => this.send(message, options),
      options?.signal,
    );
  }
}

module.exports = { MailgunTransport };
