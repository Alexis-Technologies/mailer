// Ported from upyo v0.7.0 (packages/sendgrid/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { parseRetryAfter } = require('../core/receipt.js');
const { exponentialDelayMs, requestWithRetry } = require('../internal/http.js');

/**
 * HTTP client wrapper for SendGrid API requests.
 *
 * This class handles authentication, request formatting, error handling,
 * and retry logic for SendGrid API calls.
 */
class SendGridHttpClient {
  config;

  constructor(config) {
    this.config = config;
  }

  /**
   * Sends a message via SendGrid API.
   *
   * @param messageData The JSON data to send to SendGrid.
   * @param signal Optional AbortSignal for cancellation.
   * @returns Promise that resolves to the SendGrid response.
   */
  sendMessage(messageData, signal) {
    const url = `${this.config.baseUrl}/mail/send`;

    return this.makeRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messageData),
      signal,
    });
  }

  /**
   * Makes an HTTP request to SendGrid API with retry logic.
   *
   * @param url The URL to make the request to.
   * @param options Fetch options.
   * @returns Promise that resolves to the parsed response.
   * @throws {DOMException} If the caller aborts the request.
   * @throws {SendGridApiError} If SendGrid returns a client error or all retry
   *                            attempts are exhausted.
   */
  makeRequest(url, options) {
    return requestWithRetry({
      signal: options.signal,
      retries: this.config.retries,
      timeoutMs: this.config.timeout,
      send: (signal) => this.fetchWithAuth(url, options, signal),
      read: async (response, attempt) => {
        const text = await response.text();
        // SendGrid returns 202 for successful sends
        if (response.status !== 202) throw createSendGridApiError(response, text, attempt);
        return {
          statusCode: response.status,
          body: text,
          headers: this.headersToRecord(response.headers),
        };
      },
      reject: async (response, attempt) =>
        createSendGridApiError(response, await response.text(), attempt),
      createTimeoutError: () =>
        new Error(`SendGrid API request timed out after ${this.config.timeout} ms.`),
      isRetryable: (error) => !isClientError(error),
      retryDelayMs: exponentialDelayMs,
      finalError: (error, attempts) =>
        error instanceof SendGridApiError
          ? error
          : new SendGridApiError(error.message, undefined, undefined, undefined, attempts),
    });
  }

  /**
   * Makes a fetch request with SendGrid authentication.
   *
   * @param url The URL to make the request to.
   * @param options Fetch options.
   * @param signal The signal of the attempt, with its deadline.
   * @returns Promise that resolves to the fetch response.
   */
  fetchWithAuth(url, options, signal) {
    const headers = new Headers(options.headers);

    // Add authentication header
    headers.set('Authorization', `Bearer ${this.config.apiKey}`);

    // Add custom headers from config
    for (const [key, value] of Object.entries(this.config.headers)) {
      headers.set(key, value);
    }

    return globalThis.fetch(url, { ...options, headers, signal });
  }

  /**
   * Converts Headers object to a plain Record.
   *
   * @param headers The Headers object to convert.
   * @returns A plain object with header key-value pairs.
   */
  headersToRecord(headers) {
    const record = {};
    for (const [key, value] of headers.entries()) {
      record[key] = value;
    }
    return record;
  }
}

/**
 * Error thrown when a SendGrid API request fails.
 */
class SendGridApiError extends Error {
  /**
   * HTTP status code returned by SendGrid, if the request reached the API.
   */
  statusCode;

  /**
   * Provider-supplied SendGrid error details.
   */
  errors;

  /**
   * Retry delay from SendGrid's `Retry-After` response header.
   */
  retryAfterMilliseconds;

  /**
   * Number of attempts made before this error was produced.
   */
  attempts;

  /**
   * Creates a SendGrid API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code returned by SendGrid.
   * @param errors Provider-supplied SendGrid error details.
   * @param retryAfterMilliseconds Retry delay from the response.
   * @param attempts Number of attempts made before this error.
   */
  constructor(message, statusCode, errors, retryAfterMilliseconds, attempts) {
    super(message);
    this.name = 'SendGridApiError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.retryAfterMilliseconds = retryAfterMilliseconds;
    this.attempts = attempts;
  }
}

const createSendGridApiError = (response, text, attempt) => {
  let errorData;
  try {
    errorData = JSON.parse(text);
  } catch {
    errorData = { message: text || `HTTP ${response.status}` };
  }

  return new SendGridApiError(
    errorData.message || `HTTP ${response.status}`,
    response.status,
    errorData.errors,
    parseRetryAfter(response.headers.get('Retry-After')),
    attempt + 1,
  );
};

const isClientError = (error) =>
  error instanceof SendGridApiError && error.statusCode >= 400 && error.statusCode < 500;

module.exports = { SendGridHttpClient, SendGridApiError };
