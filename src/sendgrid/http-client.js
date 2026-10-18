// Ported from upyo v0.7.0 (packages/sendgrid/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee
// Changed after the port: the request goes through createApiClient of
// internal/api-client.js, as that of every HTTP provider does, and SendGridApiError
// extends its error; the messages and the errors of upstream stay.

const { parseRetryAfter } = require('../core/receipt.js');
const { ProviderApiError, createApiClient } = require('../internal/api-client.js');

/**
 * Error thrown when a SendGrid API request fails.
 */
class SendGridApiError extends ProviderApiError {
  /**
   * Provider-supplied SendGrid error details.
   */
  errors;

  /**
   * Creates a SendGrid API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code returned by SendGrid.
   * @param errors Provider-supplied SendGrid error details.
   * @param retryAfterMilliseconds Retry delay from the response.
   * @param attempts Number of attempts made before this error.
   * @param options The cause of the error, such as the failure of `fetch`.
   */
  constructor(message, statusCode, errors, retryAfterMilliseconds, attempts, options) {
    super('sendgrid', message, {
      statusCode,
      retryAfterMilliseconds,
      attempts,
      cause: options?.cause,
      providerDetails: errors,
    });
    this.name = 'SendGridApiError';
    this.errors = errors;
  }
}

const createSendGridApiError = (response, read, attempt) => {
  const text = read ?? '';
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

/**
 * Converts Headers object to a plain Record.
 *
 * @param headers The Headers object to convert.
 * @returns A plain object with header key-value pairs.
 */
const headersToRecord = (headers) => {
  const record = {};
  for (const [key, value] of headers.entries()) {
    record[key] = value;
  }
  return record;
};

/**
 * HTTP client wrapper for SendGrid API requests.
 *
 * This class handles authentication, request formatting, error handling,
 * and retry logic for SendGrid API calls.
 */
class SendGridHttpClient {
  config;
  #request;

  constructor(config) {
    this.config = config;
    const client = createApiClient(config, {
      id: 'sendgrid',
      label: 'SendGrid',
      authorize: (headers) => headers.set('Authorization', `Bearer ${config.apiKey}`),
      read: (response, text, attempt) => {
        // SendGrid returns 202 for successful sends
        if (response.status !== 202) throw createSendGridApiError(response, text, attempt);
        return {
          statusCode: response.status,
          body: text,
          headers: headersToRecord(response.headers),
        };
      },
      reject: createSendGridApiError,
      timeoutError: () => new Error(`SendGrid API request timed out after ${config.timeout} ms.`),
      finalError: (error, attempts) =>
        error instanceof SendGridApiError
          ? error
          : new SendGridApiError(error.message, undefined, undefined, undefined, attempts, {
              cause: error,
            }),
    });
    this.log = client.log;
    this.fetchWithAuth = client.fetchWithAuth;
    this.#request = client.request;
  }

  /**
   * Sends a message via SendGrid API.
   *
   * @param messageData The JSON data to send to SendGrid.
   * @param signal Optional AbortSignal for cancellation.
   * @param onRetry Optional callback told of each retry.
   * @returns Promise that resolves to the SendGrid response.
   * @throws {DOMException} If the caller aborts the request.
   * @throws {SendGridApiError} If SendGrid returns a client error or all retry
   *                            attempts are exhausted.
   */
  sendMessage(messageData, signal, onRetry) {
    return this.#request({
      url: `${this.config.baseUrl}/mail/send`,
      body: messageData,
      signal,
      onRetry,
    });
  }
}

module.exports = { SendGridHttpClient, SendGridApiError };
