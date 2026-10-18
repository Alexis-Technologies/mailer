// Ported from upyo v0.7.0 (packages/mailtrap/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee
// Changed after the port: the request goes through createApiClient of
// internal/api-client.js, as that of every HTTP provider does, and the
// errors extend its error; the messages and the errors of upstream stay.

const { parseRetryAfter } = require('../core/receipt.js');
const {
  ProviderApiError,
  createApiClient,
  parseAnswer,
  truncateErrorText,
} = require('../internal/api-client.js');

const sandboxRateLimitWindowMilliseconds = 10_000;
const sandboxRateLimitMessage = 'too many emails per second';

/**
 * Mailtrap API error class for API-specific failures.
 */
class MailtrapApiError extends ProviderApiError {
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
    super('mailtrap', message, { statusCode, retryAfterMilliseconds, attempts });
    this.name = 'MailtrapApiError';
  }
}

/**
 * Mailtrap request timeout error.
 */
class MailtrapTimeoutError extends ProviderApiError {
  /**
   * Request timeout in milliseconds.
   */
  timeout;

  /**
   * Creates a Mailtrap request timeout error.
   *
   * @param timeout Request timeout in milliseconds.
   * @param attempts Number of attempts made before this error.
   */
  constructor(timeout, attempts) {
    super('mailtrap', `Mailtrap API request timed out after ${timeout} ms.`, {
      attempts,
      category: 'timeout',
      code: 'timeout',
      retryable: true,
    });
    this.name = 'MailtrapTimeoutError';
    this.timeout = timeout;
  }
}

/**
 * Failure to read a successful Mailtrap response after the request was accepted.
 * Retrying the request could send the message again.
 */
class MailtrapResponseError extends ProviderApiError {
  /**
   * Creates an error for an unreadable successful response.
   *
   * @param cause The response body error, including a possible timeout.
   * @param attempts Number of attempts made before this error.
   */
  constructor(cause, attempts) {
    const timedOut = cause instanceof MailtrapTimeoutError;
    super('mailtrap', cause instanceof Error ? cause.message : String(cause), {
      cause,
      attempts,
      category: timedOut ? 'timeout' : undefined,
      code: timedOut ? 'timeout' : undefined,
      retryable: false,
    });
    this.name = 'MailtrapResponseError';
  }
}

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
      return truncateErrorText(errorBody.message);
    }
    if (Array.isArray(errorBody.errors) && errorBody.errors.length > 0) {
      return truncateErrorText(errorBody.errors.join('; '));
    }
  } catch {
    // Ignore if JSON parsing fails, as the body may be non-JSON.
  }

  return truncateErrorText(text) || `HTTP ${statusCode}`;
};

const invalidJson = (error) =>
  new SyntaxError(`Invalid JSON response from Mailtrap API: ${error.message}.`, { cause: error });

/**
 * HTTP client wrapper for Mailtrap API requests.
 */
class MailtrapHttpClient {
  config;
  #request;

  /**
   * Creates a new Mailtrap HTTP client.
   *
   * @param config Resolved Mailtrap configuration.
   */
  constructor(config) {
    this.config = config;
    const client = createApiClient(config, {
      id: 'mailtrap',
      label: 'Mailtrap',
      authorize: (headers) => {
        headers.set('Api-Token', config.apiToken);
        headers.set('User-Agent', config.userAgent);
      },
      read: (_response, text) => parseAnswer(text, invalidJson),
      reject: (response, text, attempt) => {
        const message = parseErrorMessage(text ?? '', response.status);
        return new MailtrapApiError(
          message,
          response.status,
          parseRetryAfter(response.headers.get('Retry-After')) ??
            inferSandboxRetryAfter(message, response.status, config.sandbox),
          attempt + 1,
        );
      },
      timeoutError: () => new MailtrapTimeoutError(config.timeout),
      // A 2xx response means Mailtrap may already have sent the message.
      acceptedError: (error, attempts) => new MailtrapResponseError(error, attempts),
      finalError: withAttempts,
    });
    this.log = client.log;
    this.fetchWithAuth = client.fetchWithAuth;
    this.#request = client.request;
  }

  /**
   * Sends a single message via Mailtrap API.
   *
   * @param messageData The JSON data to send to Mailtrap.
   * @param signal Optional AbortSignal for cancellation.
   * @param onRetry Optional callback told of each retry.
   * @returns Promise that resolves to the Mailtrap response.
   */
  sendMessage(messageData, signal, onRetry) {
    return this.#send('send', messageData, signal, onRetry);
  }

  /**
   * Sends multiple messages via Mailtrap batch API.
   *
   * @param requests The messages to send to Mailtrap.
   * @param signal Optional AbortSignal for cancellation.
   * @param onRetry Optional callback told of each retry.
   * @returns Promise that resolves to the Mailtrap batch response.
   */
  sendBatch(requests, signal, onRetry) {
    return this.#send('batch', { requests }, signal, onRetry);
  }

  resolveUrl(kind) {
    const baseUrl = this.config.sandbox ? this.config.sandboxBaseUrl : this.config.sendBaseUrl;
    const suffix =
      this.config.sandbox && this.config.inboxId != null
        ? `/${encodeURIComponent(this.config.inboxId)}`
        : '';
    return `${baseUrl}/api/${kind}${suffix}`;
  }

  #send(kind, body, signal, onRetry) {
    return this.#request({ url: this.resolveUrl(kind), body, signal, onRetry });
  }
}

module.exports = {
  MailtrapApiError,
  MailtrapTimeoutError,
  MailtrapResponseError,
  MailtrapHttpClient,
};
