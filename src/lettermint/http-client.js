// Ported from upyo v0.7.0 (packages/lettermint/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee
// Changed after the port: the request goes through createApiClient of
// internal/api-client.js, as that of every HTTP provider does, and the
// errors extend its error; the messages and the errors of upstream stay.

const { parseRetryAfter } = require('../core/receipt.js');
const { ProviderApiError, createApiClient, parseAnswer } = require('../internal/api-client.js');

/**
 * Lettermint API error class for API-specific failures.
 */
class LettermintApiError extends ProviderApiError {
  /**
   * Creates a Lettermint API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code.
   * @param retryAfterMilliseconds Retry delay from the response.
   * @param attempts Number of attempts made before this error.
   */
  constructor(message, statusCode, retryAfterMilliseconds, attempts) {
    super('lettermint', message, { statusCode, retryAfterMilliseconds, attempts });
    this.name = 'LettermintApiError';
  }
}

/**
 * Lettermint request timeout error.
 */
class LettermintTimeoutError extends ProviderApiError {
  /**
   * Request timeout in milliseconds.
   */
  timeout;

  /**
   * Creates a Lettermint request timeout error.
   *
   * @param timeout Request timeout in milliseconds.
   * @param attempts Number of attempts made before this error.
   */
  constructor(timeout, attempts) {
    super('lettermint', `Lettermint API request timed out after ${timeout} ms.`, {
      attempts,
      category: 'timeout',
      code: 'timeout',
      retryable: true,
    });
    this.name = 'LettermintTimeoutError';
    this.timeout = timeout;
  }
}

const withAttempts = (error, attempts) => {
  if (error instanceof LettermintTimeoutError) {
    return new LettermintTimeoutError(error.timeout, attempts);
  }
  if (error instanceof LettermintApiError) {
    return error;
  }
  return Object.assign(error, { attempts });
};

const parseErrorMessage = (text, statusCode) => {
  try {
    const errorBody = JSON.parse(text);
    if (typeof errorBody.message === 'string' && errorBody.message !== '') {
      return errorBody.message;
    }
    if (typeof errorBody.error === 'string' && errorBody.error !== '') {
      return errorBody.error;
    }
    if (Array.isArray(errorBody.errors) && errorBody.errors.length > 0) {
      return JSON.stringify(errorBody.errors);
    }
  } catch {
    // Ignore if JSON parsing fails, as the body may be non-JSON.
  }

  return text || `HTTP ${statusCode}`;
};

const invalidJson = (error) =>
  new SyntaxError(`Invalid JSON response from Lettermint API: ${error.message}.`, {
    cause: error,
  });

/**
 * HTTP client wrapper for Lettermint API requests.
 */
class LettermintHttpClient {
  config;
  #request;

  /**
   * Creates a new Lettermint HTTP client.
   *
   * @param config Resolved Lettermint configuration.
   */
  constructor(config) {
    this.config = config;
    const client = createApiClient(config, {
      id: 'lettermint',
      label: 'Lettermint',
      authorize: (headers) => headers.set('x-lettermint-token', config.apiToken),
      read: (_response, text) => parseAnswer(text, invalidJson),
      reject: (response, text, attempt) =>
        new LettermintApiError(
          parseErrorMessage(text ?? '', response.status),
          response.status,
          parseRetryAfter(response.headers.get('Retry-After')),
          attempt + 1,
        ),
      timeoutError: () => new LettermintTimeoutError(config.timeout),
      finalError: withAttempts,
    });
    this.log = client.log;
    this.fetchWithAuth = client.fetchWithAuth;
    this.#request = client.request;
  }

  /**
   * Sends a single message via Lettermint API.
   *
   * @param messageData The JSON data to send to Lettermint.
   * @param signal Optional AbortSignal for cancellation.
   * @param idempotencyKey Optional idempotency key for request deduplication.
   * @param onRetry Optional callback told of each retry.
   * @returns Promise that resolves to the Lettermint response.
   */
  sendMessage(messageData, signal, idempotencyKey, onRetry) {
    return this.#send('/v1/send', messageData, signal, idempotencyKey, onRetry);
  }

  /**
   * Sends multiple messages via Lettermint batch API.
   *
   * @param messagesData Array of message data objects to send.
   * @param signal Optional AbortSignal for cancellation.
   * @param idempotencyKey Optional idempotency key for request deduplication.
   * @param onRetry Optional callback told of each retry.
   * @returns Promise that resolves to the Lettermint batch response.
   */
  sendBatch(messagesData, signal, idempotencyKey, onRetry) {
    return this.#send('/v1/send/batch', messagesData, signal, idempotencyKey, onRetry);
  }

  #send(path, body, signal, idempotencyKey, onRetry) {
    // Lettermint deduplicates a repeated Idempotency-Key.
    const hasKey = typeof idempotencyKey === 'string' && idempotencyKey !== '';
    return this.#request({
      url: `${this.config.baseUrl}${path}`,
      body,
      signal,
      onRetry,
      headers: hasKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      hasIdempotencyKey: hasKey,
    });
  }
}

module.exports = { LettermintApiError, LettermintTimeoutError, LettermintHttpClient };
