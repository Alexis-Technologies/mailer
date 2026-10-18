// Ported from upyo v0.7.0 (packages/plunk/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee
// Changed after the port: the request goes through createApiClient of
// internal/api-client.js, as that of every HTTP provider does, and
// PlunkApiError extends its error; the messages and the errors of upstream
// stay.

const { parseRetryAfter } = require('../core/receipt.js');
const {
  ProviderApiError,
  createApiClient,
  parseAnswer,
  truncateErrorText,
} = require('../internal/api-client.js');

/**
 * Plunk API error class for handling API-specific errors.
 */
class PlunkApiError extends ProviderApiError {
  /**
   * Creates a Plunk API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code returned by Plunk.
   * @param retryAfterMilliseconds Retry delay from the response.
   * @param attempts Number of attempts made before this error.
   * @param options The cause of the error, such as the failure of `fetch`.
   */
  constructor(message, statusCode, retryAfterMilliseconds, attempts, options) {
    super('plunk', message, {
      statusCode,
      retryAfterMilliseconds,
      attempts,
      cause: options?.cause,
    });
    this.name = 'PlunkApiError';
  }
}

const invalidJson = (error) => new Error('Invalid JSON response from Plunk API', { cause: error });

const parseResponse = (response, text) => {
  const data = parseAnswer(text, invalidJson);

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
};

/**
 * HTTP client wrapper for Plunk API requests.
 */
class PlunkHttpClient {
  config;
  #request;

  constructor(config) {
    this.config = config;
    const client = createApiClient(config, {
      id: 'plunk',
      label: 'Plunk',
      authorize: (headers) => headers.set('Authorization', `Bearer ${config.apiKey}`),
      read: parseResponse,
      reject: (response, text, attempt) =>
        new PlunkApiError(
          `HTTP ${response.status}: ${response.statusText}. ${truncateErrorText(
            text ?? 'Failed to read error response',
          )}`,
          response.status,
          parseRetryAfter(response.headers.get('Retry-After')),
          attempt + 1,
        ),
      timeoutError: () => new Error(`Plunk API request timed out after ${config.timeout} ms.`),
      // Plunk refusing in a 200 (success: false) is a failure of its own.
      isAnswer: (error) => error instanceof PlunkApiError,
      finalError: (error, attempts) =>
        error instanceof PlunkApiError
          ? new PlunkApiError(
              error.message,
              error.statusCode,
              error.retryAfterMilliseconds,
              attempts,
              { cause: error.cause },
            )
          : new PlunkApiError(error.message, undefined, undefined, attempts, { cause: error }),
    });
    this.log = client.log;
    this.fetchWithAuth = client.fetchWithAuth;
    this.#request = client.request;
  }

  /**
   * Sends a message via Plunk API.
   *
   * @param emailData The JSON data to send to Plunk.
   * @param signal Optional AbortSignal for cancellation.
   * @param onRetry Optional callback told of each retry.
   * @returns Promise that resolves to the Plunk response.
   */
  sendMessage(emailData, signal, onRetry) {
    return this.#request({
      url: `${this.config.baseUrl}/v1/send`,
      body: emailData,
      signal,
      onRetry,
    });
  }
}

module.exports = { PlunkApiError, PlunkHttpClient };
