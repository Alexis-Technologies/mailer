// Ported from upyo v0.7.0 (packages/mailgun/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { combineSignals } = require('../core/abort-signal.js');
const { parseRetryAfter } = require('../core/receipt.js');
const { markDeliveryUnknown } = require('../internal/delivery-unknown.js');

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
  async makeRequest(url, options) {
    let lastError = null;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      let isAccepted = false;
      try {
        const response = await this.fetchWithAuth(url, options);
        isAccepted = response.ok;
        const text = await response.text();

        if (!response.ok) {
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
          throw new MailgunApiError(
            errorMessage || truncateErrorBody(text) || `HTTP ${response.status}`,
            response.status,
            parseRetryAfter(response.headers.get('Retry-After')),
            attempt + 1,
          );
        }

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
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (options.signal?.aborted) {
          throw createAbortError(options.signal);
        }

        // A 2xx means the provider took the request: sending it again could
        // deliver the message twice, so what fails after it is not retried.
        if (isAccepted) throw markDeliveryUnknown(lastError);

        // Don't retry caller cancellation.
        if (isAbortError(error)) {
          throw error;
        }

        // Don't retry on client errors (4xx) or if it's the last attempt
        if (
          error instanceof MailgunApiError &&
          error.statusCode &&
          error.statusCode >= 400 &&
          error.statusCode < 500
        ) {
          throw error;
        }

        if (attempt === this.config.retries) {
          if (lastError instanceof MailgunApiError) {
            throw lastError;
          }
          throw new MailgunApiError(lastError.message, undefined, undefined, attempt + 1);
        }

        // Wait before retrying (exponential backoff)
        const delay = Math.pow(2, attempt) * 1000;
        await sleep(delay, options.signal);
      }
    }

    throw lastError || new Error('Request failed after all retries');
  }

  /**
   * Makes a fetch request with Mailgun authentication.
   *
   * @param url The URL to make the request to.
   * @param options Fetch options.
   * @returns Promise that resolves to the fetch response.
   * @throws {Error} If the configured request timeout is reached.
   * @throws {DOMException} If the caller aborts the request.
   */
  async fetchWithAuth(url, options) {
    const headers = new Headers(options.headers);

    // Add authentication header
    const auth = btoa(`api:${this.config.apiKey}`);
    headers.set('Authorization', `Basic ${auth}`);

    // Add custom headers from config
    for (const [key, value] of Object.entries(this.config.headers)) {
      headers.set(key, value);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    const combinedSignal = combineSignals(controller.signal, options.signal);

    try {
      return await globalThis.fetch(url, {
        ...options,
        headers,
        signal: combinedSignal.signal,
      });
    } catch (error) {
      if (isAbortError(error) && controller.signal.aborted && !options.signal?.aborted) {
        // oxlint-disable-next-line preserve-caught-error -- upstream
        throw new Error(`Mailgun API request timed out after ${this.config.timeout} ms.`);
      }
      throw error;
    } finally {
      combinedSignal.cleanup();
      clearTimeout(timeoutId);
    }
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

const isAbortError = (error) => {
  return error instanceof Error && error.name === 'AbortError';
};

const sleep = (milliseconds, signal) => {
  if (signal?.aborted) {
    return Promise.reject(createAbortError(signal));
  }

  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abort);
      reject(createAbortError(signal));
    };

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);

    signal?.addEventListener('abort', abort, { once: true });
  });
};

const createAbortError = (signal) => {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
};

const truncateErrorBody = (text) => {
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
};

module.exports = { MailgunHttpClient, MailgunApiError };
