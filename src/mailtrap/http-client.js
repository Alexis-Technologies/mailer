// Ported from upyo v0.7.0 (packages/mailtrap/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { jitteredDelayMs, requestWithRetry } = require('../internal/http.js');

const maxErrorMessageLength = 500;
const sandboxRateLimitWindowMilliseconds = 10_000;
const sandboxRateLimitMessage = 'too many emails per second';

/**
 * Mailtrap API error class for API-specific failures.
 */
class MailtrapApiError extends Error {
  statusCode;
  retryAfterMilliseconds;
  attempts;

  /**
   * Creates a Mailtrap API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code.
   * @param retryAfterMilliseconds Retry delay from the response or Mailtrap's
   * known sandbox rate-limit window.
   * @param attempts Number of attempts made before this error.
   */
  constructor(message, statusCode, retryAfterMilliseconds, attempts) {
    super(message);
    this.name = 'MailtrapApiError';
    this.statusCode = statusCode;
    this.retryAfterMilliseconds = retryAfterMilliseconds;
    this.attempts = attempts;
  }
}

/**
 * Mailtrap request timeout error.
 */
class MailtrapTimeoutError extends Error {
  /**
   * Request timeout in milliseconds.
   */
  timeout;

  /**
   * Number of attempts made before this error was produced.
   */
  attempts;

  /**
   * Creates a Mailtrap request timeout error.
   *
   * @param timeout Request timeout in milliseconds.
   * @param attempts Number of attempts made before this error.
   */
  constructor(timeout, attempts) {
    super(`Mailtrap API request timed out after ${timeout} ms.`);
    this.name = 'MailtrapTimeoutError';
    this.timeout = timeout;
    this.attempts = attempts;
  }
}

/**
 * Failure to read a successful Mailtrap response after the request was accepted.
 * Retrying the request could send the message again.
 */
class MailtrapResponseError extends Error {
  /**
   * Number of attempts made before this error was produced.
   */
  attempts;

  /**
   * Creates an error for an unreadable successful response.
   *
   * @param cause The response body error, including a possible timeout.
   * @param attempts Number of attempts made before this error.
   */
  constructor(cause, attempts) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'MailtrapResponseError';
    this.attempts = attempts;
  }
}

/**
 * HTTP client wrapper for Mailtrap API requests.
 */
class MailtrapHttpClient {
  config;

  /**
   * Creates a new Mailtrap HTTP client.
   *
   * @param config Resolved Mailtrap configuration.
   */
  constructor(config) {
    this.config = config;
  }

  /**
   * Sends a single message via Mailtrap API.
   *
   * @param messageData The JSON data to send to Mailtrap.
   * @param signal Optional AbortSignal for cancellation.
   * @returns Promise that resolves to the Mailtrap response.
   */
  sendMessage(messageData, signal) {
    const url = this.resolveUrl('send');
    return this.makeRequest(url, messageData, signal);
  }

  /**
   * Sends multiple messages via Mailtrap batch API.
   *
   * @param requests The messages to send to Mailtrap.
   * @param signal Optional AbortSignal for cancellation.
   * @returns Promise that resolves to the Mailtrap batch response.
   */
  sendBatch(requests, signal) {
    const url = this.resolveUrl('batch');
    return this.makeRequest(url, { requests }, signal);
  }

  resolveUrl(kind) {
    const baseUrl = this.config.sandbox ? this.config.sandboxBaseUrl : this.config.sendBaseUrl;
    const suffix =
      this.config.sandbox && this.config.inboxId != null ? `/${this.config.inboxId}` : '';
    return `${baseUrl}/api/${kind}${suffix}`;
  }

  makeRequest(url, body, signal) {
    return requestWithRetry({
      signal,
      retries: this.config.retries,
      timeoutMs: this.config.timeout,
      send: (attemptSignal) => this.fetchWithAuth(url, body, attemptSignal),
      read: async (response) => {
        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch (error) {
          throw new SyntaxError(
            `Invalid JSON response from Mailtrap API: ${
              error instanceof Error ? error.message : String(error)
            }.`,
          );
        }
      },
      reject: async (response, attempt) => {
        const message = parseErrorMessage(await response.text(), response.status);
        return new MailtrapApiError(
          message,
          response.status,
          parseRetryAfter(response.headers.get('Retry-After')) ??
            inferSandboxRetryAfter(message, response.status, this.config.sandbox),
          attempt + 1,
        );
      },
      createTimeoutError: () => new MailtrapTimeoutError(this.config.timeout),
      // A 2xx response means Mailtrap may already have sent the message.
      wrapAccepted: (error, attempts) => new MailtrapResponseError(error, attempts),
      isRetryable: (error) => !(error instanceof MailtrapApiError) || isRetryable(error),
      retryDelayMs: calculateRetryDelay,
      finalError: withAttempts,
    });
  }

  fetchWithAuth(url, body, signal) {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Api-Token': this.config.apiToken,
      'User-Agent': this.config.userAgent,
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

const isRetryable = (error) => {
  return error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500;
};

const calculateRetryDelay = (attempt, error) => {
  const backoffDelay = jitteredDelayMs(attempt);
  if (error instanceof MailtrapApiError) {
    return Math.max(backoffDelay, error.retryAfterMilliseconds ?? 0);
  }
  return backoffDelay;
};

const withAttempts = (error, attempts) => {
  if (error instanceof MailtrapTimeoutError) {
    return new MailtrapTimeoutError(error.timeout, attempts);
  }
  if (error instanceof MailtrapApiError) {
    return new MailtrapApiError(
      error.message,
      error.statusCode,
      error.retryAfterMilliseconds,
      attempts,
    );
  }
  return Object.assign(error, { attempts });
};

const parseRetryAfter = (header) => {
  if (header == null || header === '') return undefined;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1000);
  }
  const asDate = Date.parse(header);
  if (Number.isNaN(asDate)) return undefined;
  return Math.max(0, asDate - Date.now());
};

const inferSandboxRetryAfter = (message, statusCode, sandbox) => {
  if (sandbox && statusCode === 429 && message.toLowerCase().includes(sandboxRateLimitMessage)) {
    return sandboxRateLimitWindowMilliseconds;
  }
  return undefined;
};

const parseErrorMessage = (text, statusCode) => {
  try {
    const errorBody = JSON.parse(text);
    if (typeof errorBody.message === 'string' && errorBody.message !== '') {
      return truncateErrorMessage(errorBody.message);
    }
    if (Array.isArray(errorBody.errors) && errorBody.errors.length > 0) {
      return truncateErrorMessage(errorBody.errors.join('; '));
    }
  } catch {
    // Ignore if JSON parsing fails, as the body may be non-JSON.
  }

  return truncateErrorMessage(text) || `HTTP ${statusCode}`;
};

const truncateErrorMessage = (message) => {
  return message.length > maxErrorMessageLength
    ? `${message.slice(0, maxErrorMessageLength)}...`
    : message;
};

module.exports = {
  MailtrapApiError,
  MailtrapTimeoutError,
  MailtrapResponseError,
  MailtrapHttpClient,
};
