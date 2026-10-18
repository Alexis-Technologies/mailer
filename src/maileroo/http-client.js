// Ported from upyo v0.7.0 (packages/maileroo/src/http-client.ts)
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

/**
 * Maileroo API error class for API-specific failures.
 */
class MailerooApiError extends ProviderApiError {
  /**
   * Creates a Maileroo API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code.
   * @param retryAfterMilliseconds Retry delay from the response.
   * @param attempts Number of attempts made before this error.
   */
  constructor(message, statusCode, retryAfterMilliseconds, attempts) {
    super('maileroo', message, { statusCode, retryAfterMilliseconds, attempts });
    this.name = 'MailerooApiError';
  }
}

/**
 * Maileroo request timeout error.
 */
class MailerooTimeoutError extends ProviderApiError {
  /**
   * Request timeout in milliseconds.
   */
  timeout;

  /**
   * Creates a Maileroo request timeout error.
   *
   * @param timeout Request timeout in milliseconds.
   * @param attempts Number of attempts made before this error.
   */
  constructor(timeout, attempts) {
    super('maileroo', `Maileroo API request timed out after ${timeout} ms.`, {
      attempts,
      category: 'timeout',
      code: 'timeout',
      retryable: true,
    });
    this.name = 'MailerooTimeoutError';
    this.timeout = timeout;
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

const parseErrorMessage = (text, statusCode) => {
  try {
    const errorBody = JSON.parse(text);
    if (errorBody != null && typeof errorBody === 'object') {
      if (typeof errorBody.message === 'string' && errorBody.message !== '') {
        return truncateErrorText(errorBody.message);
      }
      if (typeof errorBody.error === 'string' && errorBody.error !== '') {
        return truncateErrorText(errorBody.error);
      }
      if (Array.isArray(errorBody.errors) && errorBody.errors.length > 0) {
        return truncateErrorText(JSON.stringify(errorBody.errors));
      }
    }
  } catch {
    // Ignore if JSON parsing fails, as the body may be non-JSON.
  }

  return truncateErrorText(text) || `HTTP ${statusCode}`;
};

const invalidJson = (error) =>
  new SyntaxError(`Invalid JSON response from Maileroo API: ${error.message}.`, { cause: error });

const parseResponse = (text) => {
  const response = parseAnswer(text, invalidJson);
  if (response == null || typeof response !== 'object') {
    throw invalidJson(new SyntaxError('response is not an object'));
  }
  return response;
};

/**
 * HTTP client wrapper for Maileroo API requests.
 */
class MailerooHttpClient {
  config;
  #request;

  /**
   * Creates a new Maileroo HTTP client.
   *
   * @param config Resolved Maileroo configuration.
   */
  constructor(config) {
    this.config = config;
    const client = createApiClient(config, {
      id: 'maileroo',
      label: 'Maileroo',
      authorize: (headers) => headers.set('X-API-Key', config.apiKey),
      read: (_response, text) => parseResponse(text),
      reject: (response, text, attempt) =>
        new MailerooApiError(
          parseErrorMessage(text ?? '', response.status),
          response.status,
          parseRetryAfter(response.headers.get('Retry-After')),
          attempt + 1,
        ),
      timeoutError: () => new MailerooTimeoutError(config.timeout),
      finalError: withAttempts,
    });
    this.log = client.log;
    this.fetchWithAuth = client.fetchWithAuth;
    this.#request = client.request;
  }

  /**
   * Sends a message via Maileroo API.
   *
   * @param messageData The JSON data to send to Maileroo.
   * @param signal Optional AbortSignal for cancellation.
   * @param onRetry Optional callback told of each retry.
   * @returns Promise that resolves to the Maileroo response.
   */
  sendMessage(messageData, signal, onRetry) {
    return this.#request({
      url: `${this.config.baseUrl}/emails`,
      body: messageData,
      signal,
      onRetry,
    });
  }
}

module.exports = { MailerooApiError, MailerooTimeoutError, MailerooHttpClient };
