// Ported from upyo v0.7.0 (packages/resend/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { parseRetryAfter } = require('../core/receipt.js');
const { exponentialDelayMs, isAbortError, requestWithRetry } = require('../internal/http.js');

/**
 * Error thrown when a Resend API request fails.
 */
class ResendApiError extends Error {
  /**
   * HTTP status code returned by Resend, if the request reached the API.
   */
  statusCode;

  /**
   * Retry delay from Resend's `Retry-After` response header.
   */
  retryAfterMilliseconds;

  /**
   * Number of attempts made before this error was produced.
   */
  attempts;

  /**
   * Creates a Resend API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code returned by Resend.
   * @param retryAfterMilliseconds Retry delay from the response.
   * @param attempts Number of attempts made before this error.
   */
  constructor(message, statusCode, retryAfterMilliseconds, attempts) {
    super(message);
    this.name = 'ResendApiError';
    this.statusCode = statusCode;
    this.retryAfterMilliseconds = retryAfterMilliseconds;
    this.attempts = attempts;
  }
}

/**
 * HTTP client wrapper for Resend API requests.
 *
 * This class handles authentication, request formatting, error handling,
 * and retry logic for Resend API calls.
 */
class ResendHttpClient {
  config;

  constructor(config) {
    this.config = config;
  }

  /**
   * Sends a single message via Resend API.
   *
   * @param messageData The JSON data to send to Resend.
   * @param signal Optional AbortSignal for cancellation.
   * @param idempotencyKey Optional idempotency key for request deduplication.
   * @returns Promise that resolves to the Resend response.
   */
  sendMessage(messageData, signal, idempotencyKey) {
    const url = `${this.config.baseUrl}/emails`;
    const headers = {
      'Content-Type': 'application/json',
    };

    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    return this.makeRequest(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(messageData),
      signal,
    });
  }

  /**
   * Sends multiple messages via Resend batch API.
   *
   * @param messagesData Array of message data objects to send.
   * @param signal Optional AbortSignal for cancellation.
   * @param idempotencyKey Optional idempotency key for request deduplication.
   * @returns Promise that resolves to the Resend batch response.
   */
  sendBatch(messagesData, signal, idempotencyKey) {
    const url = `${this.config.baseUrl}/emails/batch`;
    const headers = {
      'Content-Type': 'application/json',
    };

    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    return this.makeRequest(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(messagesData),
      signal,
    });
  }

  /**
   * Makes an HTTP request to Resend API with retry logic.
   *
   * @param url The URL to make the request to.
   * @param options Fetch options.
   * @returns Promise that resolves to the parsed response.
   */
  makeRequest(url, options) {
    return requestWithRetry({
      signal: options.signal,
      retries: this.config.retries,
      timeoutMs: this.config.timeout,
      send: (signal) => this.fetchWithAuth(url, options, signal),
      read: async (response) => {
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch (parseError) {
          // oxlint-disable-next-line preserve-caught-error -- upstream
          throw new Error(
            `Invalid JSON response from Resend API: ${
              parseError instanceof Error ? parseError.message : String(parseError)
            }`,
          );
        }
      },
      reject: async (response, attempt) => {
        const text = await response.text();
        let errorMessage;
        try {
          errorMessage = JSON.parse(text).message;
        } catch {
          // Ignore if JSON parsing fails, as the body may be non-JSON
        }

        const parsedErrorMessage = errorMessage === '' ? undefined : errorMessage;
        const responseMessage = truncateErrorBody(text);
        const fallbackMessage = responseMessage === '' ? undefined : responseMessage;

        return new ResendApiError(
          parsedErrorMessage ?? fallbackMessage ?? `HTTP ${response.status}`,
          response.status,
          parseRetryAfter(response.headers.get('Retry-After')),
          attempt + 1,
        );
      },
      createTimeoutError: () =>
        new Error(`Resend API request timed out after ${this.config.timeout} ms.`),
      isRetryable: (error) => !isClientError(error) && !isAbortError(error),
      retryDelayMs: (attempt) => Math.min(exponentialDelayMs(attempt), 10000),
      finalError: (error, attempts) =>
        error instanceof ResendApiError
          ? error
          : new ResendApiError(error.message, undefined, undefined, attempts),
      // Upstream's wait ignores the signal (CLAUDE.md, known upstream bugs).
      sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    });
  }

  /**
   * Makes a fetch request with authentication headers.
   *
   * @param url The URL to fetch.
   * @param options Fetch options.
   * @param signal The signal of the attempt, with its deadline.
   * @returns Promise that resolves to the Response.
   */
  fetchWithAuth(url, options, signal) {
    const headers = new Headers(options.headers);

    // Add authentication
    headers.set('Authorization', `Bearer ${this.config.apiKey}`);

    // Add custom headers from config
    for (const [key, value] of Object.entries(this.config.headers)) {
      headers.set(key, value);
    }

    return fetch(url, { ...options, headers, signal });
  }
}

const isClientError = (error) =>
  error instanceof ResendApiError && error.statusCode >= 400 && error.statusCode < 500;

const truncateErrorBody = (text) => {
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
};

module.exports = { ResendApiError, ResendHttpClient };
