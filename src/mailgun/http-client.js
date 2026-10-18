// Ported from upyo v0.7.0 (packages/mailgun/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee
// Changed after the port: the request goes through createApiClient of
// internal/api-client.js, as that of every HTTP provider does, and MailgunApiError
// extends its error; the messages and the errors of upstream stay.

const { Buffer } = require('node:buffer');
const { parseRetryAfter } = require('../core/receipt.js');
const {
  ProviderApiError,
  createApiClient,
  parseAnswer,
  truncateErrorText,
} = require('../internal/api-client.js');

/**
 * Error thrown when a Mailgun API request fails.
 */
class MailgunApiError extends ProviderApiError {
  /**
   * Creates a Mailgun API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code returned by Mailgun.
   * @param retryAfterMilliseconds Retry delay from the response.
   * @param attempts Number of attempts made before this error.
   * @param options The cause of the error, such as the failure of `fetch`.
   */
  constructor(message, statusCode, retryAfterMilliseconds, attempts, options) {
    super('mailgun', message, {
      statusCode,
      retryAfterMilliseconds,
      attempts,
      cause: options?.cause,
    });
    this.name = 'MailgunApiError';
  }
}

const rejectionOf = (response, read, attempt) => {
  const text = read ?? '';
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
    errorMessage || truncateErrorText(text) || `HTTP ${response.status}`,
    response.status,
    parseRetryAfter(response.headers.get('Retry-After')),
    attempt + 1,
  );
};

// This handles cases where the request was successful (e.g., 2xx status)
// but the response body is not valid JSON.
const invalidJson = (error) =>
  new Error(`Successfully received response but failed to parse JSON: ${error.message}`, {
    cause: error,
  });

/**
 * HTTP client wrapper for Mailgun API requests.
 */
class MailgunHttpClient {
  config;
  #request;

  constructor(config) {
    this.config = config;
    const client = createApiClient(config, {
      id: 'mailgun',
      label: 'Mailgun',
      authorize: (headers) => {
        const auth = Buffer.from(`api:${config.apiKey}`).toString('base64');
        headers.set('Authorization', `Basic ${auth}`);
      },
      read: (_response, text) => parseAnswer(text, invalidJson),
      reject: rejectionOf,
      timeoutError: () => new Error(`Mailgun API request timed out after ${config.timeout} ms.`),
      finalError: (error, attempts) =>
        error instanceof MailgunApiError
          ? error
          : new MailgunApiError(error.message, undefined, undefined, attempts, { cause: error }),
    });
    this.log = client.log;
    this.fetchWithAuth = client.fetchWithAuth;
    this.#request = client.request;
  }

  /**
   * Sends a message via Mailgun API.
   *
   * @param formData The form data to send to Mailgun.
   * @param signal Optional AbortSignal for cancellation.
   * @param onRetry Optional callback told of each retry.
   * @returns Promise that resolves to the Mailgun response.
   * @throws {MailgunApiError} If Mailgun returns an error response or all
   *                           retry attempts are exhausted.
   */
  sendMessage(formData, signal, onRetry) {
    return this.#send('messages', formData, signal, onRetry);
  }

  /**
   * Sends serialized MIME to the `messages.mime` endpoint.
   *
   * @param formData The `to` fields and the `message` file.
   * @param signal Optional AbortSignal for cancellation.
   * @param onRetry Optional callback told of each retry.
   * @returns Promise that resolves to the Mailgun response.
   */
  sendMime(formData, signal, onRetry) {
    return this.#send('messages.mime', formData, signal, onRetry);
  }

  #send(endpoint, formData, signal, onRetry) {
    // The domain is a path segment: encoded, it cannot climb the path.
    const domain = encodeURIComponent(this.config.domain);
    return this.#request({
      url: `${this.config.baseUrl}/${domain}/${endpoint}`,
      body: formData,
      signal,
      onRetry,
    });
  }
}

module.exports = { MailgunHttpClient, MailgunApiError };
