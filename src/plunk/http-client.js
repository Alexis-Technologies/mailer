// Ported from upyo v0.7.0 (packages/plunk/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { parseRetryAfter } = require('../core/receipt.js');
const { exponentialDelayMs, isAbortError, requestWithRetry } = require('../internal/http.js');

/**
 * Error thrown when a Plunk API request fails.
 */
class PlunkApiError extends Error {
  /**
   * HTTP status code returned by Plunk, if the request reached the API.
   */
  statusCode;

  /**
   * Retry delay from Plunk's `Retry-After` response header.
   */
  retryAfterMilliseconds;

  /**
   * Number of attempts made before this error was produced.
   */
  attempts;

  /**
   * Creates a Plunk API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code returned by Plunk.
   * @param retryAfterMilliseconds Retry delay from the response.
   * @param attempts Number of attempts made before this error.
   */
  constructor(message, statusCode, retryAfterMilliseconds, attempts) {
    super(message);
    this.name = 'PlunkApiError';
    this.statusCode = statusCode;
    this.retryAfterMilliseconds = retryAfterMilliseconds;
    this.attempts = attempts;
  }
}

/**
 * HTTP client wrapper for Plunk API requests.
 *
 * This class handles authentication, request formatting, error handling,
 * and retry logic for the Plunk HTTP API.
 */
class PlunkHttpClient {
  config;

  /**
   * Creates a new Plunk HTTP client instance.
   *
   * @param config - Resolved Plunk configuration
   */
  constructor(config) {
    this.config = config;
  }

  /**
   * Sends a message via the Plunk API.
   *
   * This method makes a POST request to the `/v1/send` endpoint with proper
   * authentication, retry logic, and error handling.
   *
   * @param emailData - The email data in Plunk API format
   * @param signal - Optional AbortSignal for request cancellation
   * @returns Promise that resolves to Plunk API response
   * @throws PlunkError if the request fails after all retries
   */
  sendMessage(emailData, signal) {
    const url = `${this.config.baseUrl}/v1/send`;

    return requestWithRetry({
      signal,
      retries: this.config.retries,
      timeoutMs: this.config.timeout,
      isZeroTimeoutDisabled: true,
      send: (attemptSignal) => this.makeRequest(url, emailData, attemptSignal),
      read: (response) => this.parseResponse(response),
      reject: async (response, attempt) => {
        let errorBody;
        try {
          errorBody = await response.text();
        } catch {
          errorBody = 'Failed to read error response';
        }

        return new PlunkApiError(
          `HTTP ${response.status}: ${response.statusText}. ${truncateErrorBody(errorBody)}`,
          response.status,
          parseRetryAfter(response.headers.get('Retry-After')),
          attempt + 1,
        );
      },
      createTimeoutError: () =>
        new Error(`Plunk API request timed out after ${this.config.timeout} ms.`),
      // Plunk refusing in a 200 (success: false) is a failure of its own.
      isAnswer: (error) => error instanceof PlunkApiError,
      isRetryable: (error) => !isClientError(error) && !isAbortError(error),
      retryDelayMs: (attempt) => Math.min(exponentialDelayMs(attempt), 10000),
      finalError: (error, attempts) =>
        error instanceof PlunkApiError
          ? new PlunkApiError(
              error.message,
              error.statusCode,
              error.retryAfterMilliseconds,
              attempts,
            )
          : new PlunkApiError(error.message, undefined, undefined, attempts),
      // Upstream's wait ignores the signal (CLAUDE.md, known upstream bugs).
      sleep: (milliseconds) => this.sleep(milliseconds),
    });
  }

  /**
   * Makes an HTTP request to the Plunk API.
   *
   * @param url - The request URL
   * @param emailData - The email data to send
   * @param signal - Optional AbortSignal for cancellation
   * @returns Promise that resolves to the Response object
   */
  makeRequest(url, emailData, signal) {
    const headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      ...this.config.headers,
    };

    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(emailData),
      signal,
    });
  }

  /**
   * Parses the response from the Plunk API.
   *
   * @param response - The Response object from fetch
   * @returns Promise that resolves to parsed PlunkResponse
   */
  async parseResponse(response) {
    try {
      const data = await response.json();

      // Validate response structure
      if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid response format: expected object');
      }

      if (typeof data.success !== 'boolean') {
        throw new Error('Invalid response format: missing success field');
      }

      if (!data.success) {
        throw new PlunkApiError(
          data.message ?? 'Send operation failed without error details',
          response.status,
        );
      }

      const responseData = 'data' in data ? data.data : data;
      if (typeof responseData !== 'object' || responseData === null) {
        throw new Error('Invalid response format: missing data field');
      }

      return {
        success: true,
        emails: responseData.emails,
        timestamp: responseData.timestamp,
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        // oxlint-disable-next-line preserve-caught-error -- upstream
        throw new Error('Invalid JSON response from Plunk API');
      }
      throw error;
    }
  }

  /**
   * Sleeps for the specified number of milliseconds.
   *
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after the delay
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const isClientError = (error) =>
  error instanceof PlunkApiError && error.statusCode >= 400 && error.statusCode < 500;

const truncateErrorBody = (text) => {
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
};

module.exports = { PlunkApiError, PlunkHttpClient };
