// Ported from upyo v0.7.0 (packages/resend/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { parseRetryAfter } = require('../core/receipt.js');
const { requestWithRetry } = require('../internal/http.js');
const { readText } = require('../internal/body.js');

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
   * @param options The cause of the error, such as the failure of `fetch`.
   */
  constructor(message, statusCode, retryAfterMilliseconds, attempts, options) {
    super(message, options);
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
        const text = await readText(response);
        try {
          return JSON.parse(text);
        } catch (parseError) {
          throw new Error(
            `Invalid JSON response from Resend API: ${
              parseError instanceof Error ? parseError.message : String(parseError)
            }`,
            { cause: parseError },
          );
        }
      },
      reject: async (response, attempt) => {
        const text = await readText(response);
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
      finalError: (error, attempts) =>
        error instanceof ResendApiError
          ? error
          : new ResendApiError(error.message, undefined, undefined, attempts, { cause: error }),
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

    // A redirect comes back as a response rather than being followed, so the
    // credentials in the headers never reach another origin.
    return fetch(url, { ...options, headers, signal, redirect: 'manual' });
  }
}

const truncateErrorBody = (text) => {
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
};

module.exports = { ResendApiError, ResendHttpClient };
