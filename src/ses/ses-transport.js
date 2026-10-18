// Ported from upyo v0.7.0 (packages/ses/src/ses-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { generateId } = require('../core/id.js');
const { classifyReceiptError, createFailedReceipt } = require('../core/receipt.js');
const { createSesConfig } = require('./config.js');
const { SesApiError, SesHttpClient } = require('./http-client.js');
const { convertMessage, convertRawMessage } = require('./message-converter.js');
const { rawMessageFailure, readRawMessage } = require('../internal/raw.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { isDeliveryUnknown } = require('../internal/delivery-unknown.js');
const { chunks } = require('../internal/batch.js');
const { certificateFailure, refusalFailure } = require('../internal/refusal.js');
const { verifyByRequest } = require('../internal/verify.js');

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
    checkAuthentication(this.config.authentication);
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
   * Verifies the credentials and the region with GetAccount.  A key that may
   * send but not read the account (AccessDenied) is verified too.
   *
   * @param options Optional abort signal.
   * @throws {Error} If SES refuses the credentials or cannot be reached.
   */
  async verify(options) {
    options?.signal?.throwIfAborted();
    const url = `https://email.${this.config.region}.amazonaws.com/v2/email/account`;
    await verifyByRequest({
      provider: 'SES',
      send: (signal) => this.httpClient.fetchWithAuth(url, { method: 'GET' }, signal),
      retries: this.config.retries,
      timeoutMs: this.config.timeout,
      signal: options?.signal,
      log: this.httpClient.log,
    });
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

      const response = await this.httpClient.sendMessage(
        sesMessage,
        options?.signal,
        options?.onRetry,
      );

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
   * Sends serialized MIME as the Raw content of SendEmail, to the recipients
   * of its envelope and from its sender.  The message is checked as SMTP
   * checks it and read into memory; DKIM and composition are bypassed.
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
      const response = await this.httpClient.sendMessage(
        convertRawMessage(raw, this.config),
        options?.signal,
        options?.onRetry,
      );
      return { successful: true, messageId: this.extractMessageId(response), provider: 'ses' };
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      return rawMessageFailure('ses', error) ?? createSesFailure(errorMessage, error);
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

    // A batch is read when the one before it is sent, not the whole input
    // first.
    for await (const batch of chunks(messages, this.config.batchSize)) {
      options?.signal?.throwIfAborted();
      yield* await this.sendConcurrent(batch, options);
    }
  }

  async sendConcurrent(messages, options) {
    options?.signal?.throwIfAborted();

    const sending = [];
    for (const message of messages) sending.push(this.send(message, options));
    return await Promise.all(sending);
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

    return `ses-${generateId('receipt-id', this.config.generateId)}`;
  }
}

const isFilled = (value) => typeof value === 'string' && value !== '';

// A wrong authentication is refused when the transport is made: found at the
// first send, it was retried like an outage before it failed.
const checkAuthentication = (authentication) => {
  const type = authentication?.type;
  if (type !== 'credentials' && type !== 'session') {
    throw new TypeError(`Unsupported authentication type: ${type}`);
  }
  if (!isFilled(authentication.accessKeyId) || !isFilled(authentication.secretAccessKey)) {
    throw new TypeError('SES authentication needs an accessKeyId and a secretAccessKey.');
  }
  if (type === 'session' && !isFilled(authentication.sessionToken)) {
    throw new TypeError('SES session authentication needs its sessionToken.');
  }
};

const createSesFailure = (message, error) => {
  const known = refusalFailure('ses', error) ?? certificateFailure('ses', message, error);
  if (known !== undefined) return known;
  if (error instanceof SesApiError) {
    return createFailedReceipt(message, {
      deliveryUnknown: isDeliveryUnknown(error),
      provider: 'ses',
      statusCode: error.statusCode,
      retryAfterMilliseconds: error.retryAfterMilliseconds,
      providerDetails: error.errors,
      attempts: error.attempts,
    });
  }

  // By the codes along its causes first, then by its words.
  const { category, retryable } = classifyReceiptError(error);
  return createFailedReceipt(message, {
    deliveryUnknown: isDeliveryUnknown(error),
    provider: 'ses',
    category,
    retryable,
  });
};

const isCallerAbort = (error, signal) => {
  return signal?.aborted === true && (isAbortError(error) || error === signal.reason);
};

const isAbortError = (error) => {
  return error instanceof Error && error.name === 'AbortError';
};

module.exports = { SesTransport };
