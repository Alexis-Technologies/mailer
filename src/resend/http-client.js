// Ported from upyo v0.7.0 (packages/resend/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee
// Changed after the port: the request goes through createApiClient of
// internal/api-client.js, as that of every HTTP provider does, and ResendApiError
// extends its error; the messages and the errors of upstream stay.

const { parseRetryAfter } = require('../core/receipt.js');
const {
  ProviderApiError,
  createApiClient,
  parseAnswer,
  truncateErrorText,
} = require('../internal/api-client.js');

/**
 * Error thrown when a Resend API request fails.
 */
class ResendApiError extends ProviderApiError {
  /**
   * Creates a Resend API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code returned by Resend.
   * @param retryAfterMilliseconds Retry delay from the response.
   * @param attempts Number of attempts made before this error.
   * @param options The cause of the error, such as the failure of `fetch`.
   */
  constructor(message, statusCode, retryAfterMilliseconds, attempts, options) {
    super('resend', message, {
      statusCode,
      retryAfterMilliseconds,
      attempts,
      cause: options?.cause,
    });
    this.name = 'ResendApiError';
  }
}

const messageOf = (text) => {
  try {
    return JSON.parse(text).message;
  } catch {
    // Ignore if JSON parsing fails, as the body may be non-JSON
    return undefined;
  }
};

const rejectionOf = (response, read, attempt) => {
  const text = read ?? '';
  const parsed = messageOf(text);
  const parsedErrorMessage = parsed === '' ? undefined : parsed;
  const responseMessage = truncateErrorText(text);
  const fallbackMessage = responseMessage === '' ? undefined : responseMessage;
  return new ResendApiError(
    parsedErrorMessage ?? fallbackMessage ?? `HTTP ${response.status}`,
    response.status,
    parseRetryAfter(response.headers.get('Retry-After')),
    attempt + 1,
  );
};

const invalidJson = (error) =>
  new Error(`Invalid JSON response from Resend API: ${error.message}`, { cause: error });

/**
 * HTTP client wrapper for Resend API requests.
 *
 * This class handles authentication, request formatting, error handling,
 * and retry logic for Resend API calls.
 */
class ResendHttpClient {
  config;
  #request;

  constructor(config) {
    this.config = config;
    const client = createApiClient(config, {
      id: 'resend',
      label: 'Resend',
      authorize: (headers) => headers.set('Authorization', `Bearer ${config.apiKey}`),
      read: (_response, text) => parseAnswer(text, invalidJson),
      reject: rejectionOf,
      timeoutError: () => new Error(`Resend API request timed out after ${config.timeout} ms.`),
      finalError: (error, attempts) =>
        error instanceof ResendApiError
          ? error
          : new ResendApiError(error.message, undefined, undefined, attempts, { cause: error }),
    });
    this.log = client.log;
    this.fetchWithAuth = client.fetchWithAuth;
    this.#request = client.request;
  }

  /**
   * Sends a single message via Resend API.
   *
   * @param messageData The JSON data to send to Resend.
   * @param signal Optional AbortSignal for cancellation.
   * @param idempotencyKey Optional idempotency key for request deduplication.
   * @param onRetry Optional callback told of each retry.
   * @returns Promise that resolves to the Resend response.
   */
  sendMessage(messageData, signal, idempotencyKey, onRetry) {
    return this.#send('/emails', messageData, signal, idempotencyKey, onRetry);
  }

  /**
   * Sends multiple messages via Resend batch API.
   *
   * @param messagesData Array of message data objects to send.
   * @param signal Optional AbortSignal for cancellation.
   * @param idempotencyKey Optional idempotency key for request deduplication.
   * @param onRetry Optional callback told of each retry.
   * @returns Promise that resolves to the Resend batch response.
   */
  sendBatch(messagesData, signal, idempotencyKey, onRetry) {
    return this.#send('/emails/batch', messagesData, signal, idempotencyKey, onRetry);
  }

  #send(path, body, signal, idempotencyKey, onRetry) {
    // Resend answers a repeated Idempotency-Key with its first answer.
    const hasKey = typeof idempotencyKey === 'string' && idempotencyKey !== '';
    return this.#request({
      url: `${this.config.baseUrl}${path}`,
      body,
      signal,
      onRetry,
      headers: hasKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      hasIdempotencyKey: hasKey,
    });
  }
}

module.exports = { ResendApiError, ResendHttpClient };
