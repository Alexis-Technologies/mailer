// Ported from upyo v0.7.0 (packages/lettermint/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { parseRetryAfter } = require('../core/receipt.js');
const { requestWithRetry } = require('../internal/http.js');
const { readText } = require('../internal/body.js');

/**
 * Lettermint API error class for API-specific failures.
 */
class LettermintApiError extends Error {
  statusCode;
  retryAfterMilliseconds;
  attempts;

  /**
   * Creates a Lettermint API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code.
   * @param retryAfterMilliseconds Retry delay from the response.
   * @param attempts Number of attempts made before this error.
   */
  constructor(message, statusCode, retryAfterMilliseconds, attempts) {
    super(message);
    this.name = 'LettermintApiError';
    this.statusCode = statusCode;
    this.retryAfterMilliseconds = retryAfterMilliseconds;
    this.attempts = attempts;
  }
}

/**
 * Lettermint request timeout error.
 */
class LettermintTimeoutError extends Error {
  /**
   * Request timeout in milliseconds.
   */
  timeout;

  /**
   * Number of attempts made before this error was produced.
   */
  attempts;

  /**
   * Creates a Lettermint request timeout error.
   *
   * @param timeout Request timeout in milliseconds.
   * @param attempts Number of attempts made before this error.
   */
  constructor(timeout, attempts) {
    super(`Lettermint API request timed out after ${timeout} ms.`);
    this.name = 'LettermintTimeoutError';
    this.timeout = timeout;
    this.attempts = attempts;
  }
}

/**
 * HTTP client wrapper for Lettermint API requests.
 */
class LettermintHttpClient {
  config;

  /**
   * Creates a new Lettermint HTTP client.
   *
   * @param config Resolved Lettermint configuration.
   */
  constructor(config) {
    this.config = config;
  }

  /**
   * Sends a single message via Lettermint API.
   *
   * @param messageData The JSON data to send to Lettermint.
   * @param signal Optional AbortSignal for cancellation.
   * @param idempotencyKey Optional idempotency key for request deduplication.
   * @returns Promise that resolves to the Lettermint response.
   */
  sendMessage(messageData, signal, idempotencyKey, onRetry) {
    const url = `${this.config.baseUrl}/v1/send`;
    return this.makeRequest(url, messageData, signal, idempotencyKey, onRetry);
  }

  /**
   * Sends multiple messages via Lettermint batch API.
   *
   * @param messagesData The messages to send to Lettermint.
   * @param signal Optional AbortSignal for cancellation.
   * @param idempotencyKey Optional idempotency key for request deduplication.
   * @returns Promise that resolves to the Lettermint batch response.
   */
  sendBatch(messagesData, signal, idempotencyKey, onRetry) {
    const url = `${this.config.baseUrl}/v1/send/batch`;
    return this.makeRequest(url, messagesData, signal, idempotencyKey, onRetry);
  }

  makeRequest(url, body, signal, idempotencyKey, onRetry) {
    // Serialized once rather than on every attempt.
    const json = JSON.stringify(body);
    return requestWithRetry({
      signal,
      onRetry,
      retries: this.config.retries,
      timeoutMs: this.config.timeout,
      // Lettermint deduplicates a repeated Idempotency-Key.
      hasIdempotencyKey: idempotencyKey != null && idempotencyKey !== '',
      send: (attemptSignal) => this.fetchWithAuth(url, json, attemptSignal, idempotencyKey),
      read: async (response) => {
        const text = await readText(response);
        try {
          return JSON.parse(text);
        } catch (error) {
          throw new SyntaxError(
            `Invalid JSON response from Lettermint API: ${
              error instanceof Error ? error.message : String(error)
            }.`,
            { cause: error },
          );
        }
      },
      reject: async (response, attempt) =>
        new LettermintApiError(
          parseErrorMessage(await readText(response), response.status),
          response.status,
          parseRetryAfter(response.headers.get('Retry-After')),
          attempt + 1,
        ),
      createTimeoutError: () => new LettermintTimeoutError(this.config.timeout),
      finalError: withAttempts,
    });
  }

  fetchWithAuth(url, json, signal, idempotencyKey) {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'x-lettermint-token': this.config.apiToken,
    });

    if (idempotencyKey) {
      headers.set('Idempotency-Key', idempotencyKey);
    }

    for (const [key, value] of Object.entries(this.config.headers)) {
      headers.set(key, value);
    }

    // A redirect comes back as a response rather than being followed, so the
    // credentials in the headers never reach another origin.
    return globalThis.fetch(url, {
      method: 'POST',
      headers,
      body: json,
      signal,
      redirect: 'manual',
    });
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

module.exports = { LettermintApiError, LettermintTimeoutError, LettermintHttpClient };
