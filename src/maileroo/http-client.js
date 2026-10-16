// Ported from upyo v0.7.0 (packages/maileroo/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { parseRetryAfter } = require('../core/receipt.js');
const { jitteredDelayMs, requestWithRetry } = require('../internal/http.js');

const maxErrorMessageLength = 500;

/**
 * Maileroo API error class for API-specific failures.
 */
class MailerooApiError extends Error {
  statusCode;
  retryAfterMilliseconds;
  attempts;

  /**
   * Creates a Maileroo API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code.
   * @param retryAfterMilliseconds Retry delay from the response.
   * @param attempts Number of attempts made before this error.
   */
  constructor(message, statusCode, retryAfterMilliseconds, attempts) {
    super(message);
    this.name = 'MailerooApiError';
    this.statusCode = statusCode;
    this.retryAfterMilliseconds = retryAfterMilliseconds;
    this.attempts = attempts;
  }
}

/**
 * Maileroo request timeout error.
 */
class MailerooTimeoutError extends Error {
  /**
   * Request timeout in milliseconds.
   */
  timeout;

  /**
   * Number of attempts made before this error was produced.
   */
  attempts;

  /**
   * Creates a Maileroo request timeout error.
   *
   * @param timeout Request timeout in milliseconds.
   * @param attempts Number of attempts made before this error.
   */
  constructor(timeout, attempts) {
    super(`Maileroo API request timed out after ${timeout} ms.`);
    this.name = 'MailerooTimeoutError';
    this.timeout = timeout;
    this.attempts = attempts;
  }
}

/**
 * HTTP client wrapper for Maileroo API requests.
 */
class MailerooHttpClient {
  config;

  /**
   * Creates a new Maileroo HTTP client.
   *
   * @param config Resolved Maileroo configuration.
   */
  constructor(config) {
    this.config = config;
  }

  /**
   * Sends a single message via Maileroo API.
   *
   * @param messageData The JSON data to send to Maileroo.
   * @param signal Optional AbortSignal for cancellation.
   * @returns Promise that resolves to the Maileroo response.
   * @throws {MailerooApiError} If Maileroo returns an API error.
   * @throws {MailerooTimeoutError} If the request timeout elapses.
   */
  sendMessage(messageData, signal) {
    const url = `${this.config.baseUrl}/emails`;
    return this.makeRequest(url, messageData, signal);
  }

  makeRequest(url, body, signal) {
    return requestWithRetry({
      signal,
      retries: this.config.retries,
      timeoutMs: this.config.timeout,
      isZeroTimeoutDisabled: true,
      send: (attemptSignal) => this.fetchWithAuth(url, body, attemptSignal),
      read: async (response) => parseResponse(await response.text()),
      reject: async (response, attempt) =>
        new MailerooApiError(
          parseErrorMessage(await response.text(), response.status),
          response.status,
          parseRetryAfter(response.headers.get('Retry-After')),
          attempt + 1,
        ),
      createTimeoutError: () => new MailerooTimeoutError(this.config.timeout),
      isRetryable: (error) => !(error instanceof MailerooApiError) || isRetryable(error),
      retryDelayMs: calculateRetryDelay,
      finalError: withAttempts,
    });
  }

  fetchWithAuth(url, body, signal) {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'X-API-Key': this.config.apiKey,
    });

    for (const [key, value] of Object.entries(this.config.headers)) {
      headers.set(key, value);
    }

    return globalThis.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  }
}

const withAttempts = (error, attempts) => {
  if (error instanceof MailerooTimeoutError) {
    return new MailerooTimeoutError(error.timeout, attempts);
  }
  if (error instanceof MailerooApiError) {
    return error;
  }
  return Object.assign(error, { attempts });
};

const isRetryable = (error) => {
  return error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500;
};

const calculateRetryDelay = (attempt, error) => {
  const backoffDelay = jitteredDelayMs(attempt);
  if (error instanceof MailerooApiError) {
    return Math.max(backoffDelay, error.retryAfterMilliseconds ?? 0);
  }
  return backoffDelay;
};

const parseErrorMessage = (text, statusCode) => {
  try {
    const errorBody = JSON.parse(text);
    if (errorBody != null && typeof errorBody === 'object') {
      const mailerooError = errorBody;
      if (typeof mailerooError.message === 'string' && mailerooError.message !== '') {
        return truncateErrorMessage(mailerooError.message);
      }
      if (typeof mailerooError.error === 'string' && mailerooError.error !== '') {
        return truncateErrorMessage(mailerooError.error);
      }
      if (Array.isArray(mailerooError.errors) && mailerooError.errors.length > 0) {
        return truncateErrorMessage(JSON.stringify(mailerooError.errors));
      }
    }
  } catch {
    // Ignore if JSON parsing fails, as the body may be non-JSON.
  }

  return truncateErrorMessage(text) || `HTTP ${statusCode}`;
};

const parseResponse = (text) => {
  try {
    const response = JSON.parse(text);
    if (response == null || typeof response !== 'object') {
      throw new SyntaxError('response is not an object');
    }
    return response;
  } catch (error) {
    throw new SyntaxError(
      `Invalid JSON response from Maileroo API: ${
        error instanceof Error ? error.message : String(error)
      }.`,
    );
  }
};

const truncateErrorMessage = (message) => {
  return message.length > maxErrorMessageLength
    ? `${message.slice(0, maxErrorMessageLength)}...`
    : message;
};

module.exports = { MailerooApiError, MailerooTimeoutError, MailerooHttpClient };
