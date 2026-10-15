// Ported from upyo v0.7.0 (packages/lettermint/src/lettermint-transport.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createFailedReceipt } = require('../core/receipt.js');
const { createLettermintConfig } = require('./config.js');
const {
  LettermintApiError,
  LettermintHttpClient,
  LettermintTimeoutError,
} = require('./http-client.js');
const { convertMessage, generateIdempotencyKey } = require('./message-converter.js');
const { INSPECT, inspectRedacted, redactSecrets } = require('../internal/redact.js');
const { isDeliveryUnknown } = require('../internal/delivery-unknown.js');

const MAX_BATCH_SIZE = 500;

/**
 * Lettermint transport implementation for sending emails via Lettermint API.
 *
 * @example
 * ```typescript
 * import { createMessage } from "@alexify/mailer";
 * import { LettermintTransport } from "@alexify/mailer/lettermint";
 *
 * const transport = new LettermintTransport({
 *   apiToken: "your-project-api-token",
 * });
 *
 * const receipt = await transport.send(createMessage({
 *   from: "sender@example.com",
 *   to: "recipient@example.com",
 *   subject: "Hello from Lettermint",
 *   content: { text: "Hello!" },
 * }));
 * ```
 */
class LettermintTransport {
  id = 'lettermint';

  /**
   * The resolved Lettermint configuration used by this transport.
   */
  config;

  httpClient;

  /**
   * Creates a new Lettermint transport instance.
   *
   * @param config Lettermint configuration including API token and options.
   */
  constructor(config) {
    this.config = createLettermintConfig(config);
    this.httpClient = new LettermintHttpClient(this.config);
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
   * Sends a single email message via Lettermint API.
   *
   * @param message The email message to send.
   * @param options Optional transport options including `AbortSignal`.
   * @returns A receipt indicating success or failure.
   */
  async send(message, options) {
    try {
      options?.signal?.throwIfAborted();

      const emailData = await convertMessage(message, this.config, options?.signal);
      const idempotencyKey = normalizeIdempotencyKey(message.idempotencyKey);

      options?.signal?.throwIfAborted();

      const response = await this.httpClient.sendMessage(
        emailData,
        options?.signal,
        idempotencyKey,
      );

      return responseToReceipt(response);
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      return createLettermintFailure(error instanceof Error ? error.message : String(error), error);
    }
  }

  /**
   * Sends multiple email messages via Lettermint batch API.
   *
   * Messages are chunked into Lettermint's maximum batch size of 500 messages.
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

    if (messages.some(hasIdempotencyKey)) {
      for (const message of messages) {
        yield await this.send(message, options);
      }
      return;
    }

    const idempotencyKey = normalizeIdempotencyKey(messages[0]?.idempotencyKey);
    const batchData = [];
    const receipts = [];

    for (const message of messages) {
      try {
        batchData.push(await convertMessage(message, this.config, options?.signal));
        receipts.push(undefined);
      } catch (error) {
        if (isCallerAbort(error, options?.signal)) throw error;
        receipts.push(
          createLettermintFailure(error instanceof Error ? error.message : String(error), error),
        );
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

      const response = await this.httpClient.sendBatch(batchData, options?.signal, idempotencyKey);

      let responseIndex = 0;
      for (let index = 0; index < receipts.length; index++) {
        const receipt = receipts[index];
        if (receipt !== undefined) {
          yield receipt;
          continue;
        }

        const result = response[responseIndex++];
        yield responseToReceipt(result);
      }
    } catch (error) {
      if (isCallerAbort(error, options?.signal)) throw error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      for (const receipt of receipts) {
        if (receipt !== undefined) {
          yield receipt;
          continue;
        }
        yield {
          ...createLettermintFailure(errorMessage, error),
        };
      }
    }
  }
}

const normalizeIdempotencyKey = (idempotencyKey) => {
  return idempotencyKey != null && idempotencyKey !== ''
    ? idempotencyKey
    : generateIdempotencyKey();
};

const hasIdempotencyKey = (message) => {
  return message.idempotencyKey != null && message.idempotencyKey !== '';
};

const responseToReceipt = (response) => {
  if (response?.message_id == null || response.message_id === '') {
    return createFailedReceipt('Lettermint response is missing a message ID.', {
      provider: 'lettermint',
      category: 'unknown',
      code: 'lettermint.missing_message_id',
      retryable: false,
    });
  }

  if (isSuccessfulStatus(response.status)) {
    return {
      successful: true,
      messageId: response.message_id,
      provider: 'lettermint',
    };
  }

  return createFailedReceipt(`Lettermint reported message status "${response.status}".`, {
    provider: 'lettermint',
    category: 'rejected',
    code: `lettermint.${response.status}`,
    retryable: response.status === 'soft_bounced',
  });
};

const createLettermintFailure = (message, error) => {
  if (error instanceof LettermintApiError) {
    return createFailedReceipt(message, {
      deliveryUnknown: isDeliveryUnknown(error),
      provider: 'lettermint',
      statusCode: error.statusCode,
      retryAfterMilliseconds: error.retryAfterMilliseconds,
      attempts: error.attempts,
    });
  }

  if (error instanceof LettermintTimeoutError) {
    return createFailedReceipt(message, {
      deliveryUnknown: isDeliveryUnknown(error),
      provider: 'lettermint',
      category: 'timeout',
      code: 'timeout',
      retryable: true,
      attempts: error.attempts,
    });
  }

  return createFailedReceipt(message, {
    deliveryUnknown: isDeliveryUnknown(error),
    provider: 'lettermint',
    attempts: getErrorAttempts(error),
  });
};

const getErrorAttempts = (error) => {
  if (typeof error !== 'object' || error == null || !('attempts' in error)) {
    return undefined;
  }
  const attempts = error.attempts;
  return typeof attempts === 'number' ? attempts : undefined;
};

const isSuccessfulStatus = (status) => {
  switch (status) {
    case 'pending':
    case 'queued':
    case 'processed':
    case 'delivered':
    case 'opened':
    case 'clicked':
      return true;
    case 'suppressed':
    case 'soft_bounced':
    case 'hard_bounced':
    case 'spam_complaint':
    case 'failed':
    case 'blocked':
    case 'policy_rejected':
    case 'unsubscribed':
      return false;
  }
};

const isAbortError = (error) => {
  return error instanceof Error && error.name === 'AbortError';
};

const isCallerAbort = (error, signal) => {
  return signal?.aborted === true && (isAbortError(error) || error === signal.reason);
};

module.exports = { LettermintTransport };
