// Ported from upyo v0.7.0 (packages/sendgrid/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { combineSignals } = require('../core/abort-signal.js');
const { parseRetryAfter } = require('../core/receipt.js');

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
  async makeRequest(url, options) {
    let lastError = null;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const response = await this.fetchWithAuth(url, options);

        // Get response text
        const text = await response.text();

        // SendGrid returns 202 for successful sends
        if (response.status === 202) {
          return {
            statusCode: response.status,
            body: text,
            headers: this.headersToRecord(response.headers),
          };
        }

        // Handle errors
        let errorData;
        try {
          errorData = JSON.parse(text);
        } catch {
          errorData = { message: text || `HTTP ${response.status}` };
        }

        throw new SendGridApiError(
          errorData.message || `HTTP ${response.status}`,
          response.status,
          errorData.errors,
          parseRetryAfter(response.headers.get('Retry-After')),
          attempt + 1,
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry caller cancellation.
        if (isCallerAbort(error, options.signal)) {
          throw error;
        }

        // Don't retry on client errors (4xx) or if it's the last attempt
        if (
          error instanceof SendGridApiError &&
          error.statusCode &&
          error.statusCode >= 400 &&
          error.statusCode < 500
        ) {
          throw error;
        }

        if (attempt === this.config.retries) {
          if (lastError instanceof SendGridApiError) {
            throw lastError;
          }
          throw new SendGridApiError(
            lastError.message,
            undefined,
            undefined,
            undefined,
            attempt + 1,
          );
        }

        // Wait before retrying (exponential backoff)
        const delay = Math.pow(2, attempt) * 1000;
        await sleep(delay, options.signal);
      }
    }

    throw lastError || new Error('Request failed after all retries');
  }

  /**
   * Makes a fetch request with SendGrid authentication.
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
    headers.set('Authorization', `Bearer ${this.config.apiKey}`);

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
        throw new Error(`SendGrid API request timed out after ${this.config.timeout} ms.`);
      }
      throw error;
    } finally {
      combinedSignal.cleanup();
      clearTimeout(timeoutId);
    }
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

const isAbortError = (error) => {
  return error instanceof Error && error.name === 'AbortError';
};

const isCallerAbort = (error, signal) => {
  return signal?.aborted === true && (isAbortError(error) || error === signal.reason);
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

module.exports = { SendGridHttpClient, SendGridApiError };
