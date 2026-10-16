// Ported from upyo v0.7.0 (packages/mailgun/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { parseRetryAfter } = require('../core/receipt.js');
const { requestWithRetry } = require('../internal/http.js');

/**
 * HTTP client wrapper for Mailgun API requests.
 *
 * This class handles authentication, request formatting, error handling,
 * and retry logic for Mailgun API calls.
 */
class MailgunHttpClient {
  config;

  constructor(config) {
    this.config = config;
  }

  /**
   * Sends a message via Mailgun API.
   *
   * @param formData The form data to send to Mailgun.
   * @param signal Optional AbortSignal for cancellation.
   * @returns Promise that resolves to the Mailgun response.
   */
  sendMessage(formData, signal) {
    const url = `${this.config.baseUrl}/${this.config.domain}/messages`;

    return this.makeRequest(url, {
      method: 'POST',
      body: formData,
      signal,
    });
  }

  /**
   * Makes an HTTP request to Mailgun API with retry logic.
   *
   * @param url The URL to make the request to.
   * @param options Fetch options.
   * @returns Promise that resolves to the parsed response.
   * @throws {MailgunApiError} If Mailgun returns an error response or all
   *                           retry attempts are exhausted.
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
        } catch (jsonError) {
          // This handles cases where the request was successful (e.g., 2xx status)
          // but the response body is not valid JSON.
          // oxlint-disable-next-line preserve-caught-error -- upstream
          throw new Error(
            `Successfully received response but failed to parse JSON: ${jsonError.message}`,
          );
        }
      },
      reject: async (response, attempt) => {
        const text = await response.text();
        let errorMessage;
        try {
          // Try to parse the error message from the JSON body
          errorMessage = JSON.parse(text)?.message;
        } catch {
          // Ignore if JSON parsing fails, as the body may be non-JSON
        }

        // Fallback logic for creating a meaningful error message.
        // 1. Use the parsed `errorMessage` if available.
        // 2. Otherwise, use the raw `text` response.
        // 3. If the raw `text` is also empty, fall back to the HTTP status.
        // Using `||` is intentional here to treat empty strings as falsy
        // and ensure a non-empty error message for the tests.
        return new MailgunApiError(
          errorMessage || truncateErrorBody(text) || `HTTP ${response.status}`,
          response.status,
          parseRetryAfter(response.headers.get('Retry-After')),
          attempt + 1,
        );
      },
      createTimeoutError: () =>
        new Error(`Mailgun API request timed out after ${this.config.timeout} ms.`),
      finalError: (error, attempts) =>
        error instanceof MailgunApiError
          ? error
          : new MailgunApiError(error.message, undefined, undefined, attempts),
    });
  }

  /**
   * Makes a fetch request with Mailgun authentication.
   *
   * @param url The URL to make the request to.
   * @param options Fetch options.
   * @param signal The signal of the attempt, with its deadline.
   * @returns Promise that resolves to the fetch response.
   */
  fetchWithAuth(url, options, signal) {
    const headers = new Headers(options.headers);

    // Add authentication header
    const auth = btoa(`api:${this.config.apiKey}`);
    headers.set('Authorization', `Basic ${auth}`);

    // Add custom headers from config
    for (const [key, value] of Object.entries(this.config.headers)) {
      headers.set(key, value);
    }

    return globalThis.fetch(url, { ...options, headers, signal });
  }
}

/**
 * Error thrown when a Mailgun API request fails.
 */
class MailgunApiError extends Error {
  /**
   * HTTP status code returned by Mailgun, if the request reached the API.
   */
  statusCode;

  /**
   * Retry delay from Mailgun's `Retry-After` response header.
   */
  retryAfterMilliseconds;

  /**
   * Number of attempts made before this error was produced.
   */
  attempts;

  /**
   * Creates a Mailgun API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code returned by Mailgun.
   * @param retryAfterMilliseconds Retry delay from the response.
   * @param attempts Number of attempts made before this error.
   */
  constructor(message, statusCode, retryAfterMilliseconds, attempts) {
    super(message);
    this.name = 'MailgunApiError';
    this.statusCode = statusCode;
    this.retryAfterMilliseconds = retryAfterMilliseconds;
    this.attempts = attempts;
  }
}

const truncateErrorBody = (text) => {
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
};

module.exports = { MailgunHttpClient, MailgunApiError };
