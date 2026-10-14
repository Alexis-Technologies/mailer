// Ported from upyo v0.7.0 (packages/lettermint/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { combineSignals } = require('../core/abort-signal.js');
const { parseRetryAfter } = require('../core/receipt.js');

/**
 * Lettermint API error class for API-specific failures.
 */
class LettermintApiError extends Error {
  statusCode;
  retryAfterMilliseconds;
  attempts;

  /**
   * Creates a Lettermint API error.
   *
   * @param message Error message.
   * @param statusCode HTTP status code.
   * @param retryAfterMilliseconds Retry delay from the response.
   * @param attempts Number of attempts made before this error.
   */
  constructor(message, statusCode, retryAfterMilliseconds, attempts) {
    super(message);
    this.name = 'LettermintApiError';
    this.statusCode = statusCode;
    this.retryAfterMilliseconds = retryAfterMilliseconds;
    this.attempts = attempts;
  }
}

/**
 * Lettermint request timeout error.
 */
class LettermintTimeoutError extends Error {
  /**
   * Request timeout in milliseconds.
   */
  timeout;

  /**
   * Number of attempts made before this error was produced.
   */
  attempts;

  /**
   * Creates a Lettermint request timeout error.
   *
   * @param timeout Request timeout in milliseconds.
   * @param attempts Number of attempts made before this error.
   */
  constructor(timeout, attempts) {
    super(`Lettermint API request timed out after ${timeout} ms.`);
    this.name = 'LettermintTimeoutError';
    this.timeout = timeout;
    this.attempts = attempts;
  }
}

/**
 * HTTP client wrapper for Lettermint API requests.
 */
class LettermintHttpClient {
  config;

  /**
   * Creates a new Lettermint HTTP client.
   *
   * @param config Resolved Lettermint configuration.
   */
  constructor(config) {
    this.config = config;
  }

  /**
   * Sends a single message via Lettermint API.
   *
   * @param messageData The JSON data to send to Lettermint.
   * @param signal Optional AbortSignal for cancellation.
   * @param idempotencyKey Optional idempotency key for request deduplication.
   * @returns Promise that resolves to the Lettermint response.
   */
  sendMessage(messageData, signal, idempotencyKey) {
    const url = `${this.config.baseUrl}/v1/send`;
    return this.makeRequest(url, messageData, signal, idempotencyKey);
  }

  /**
   * Sends multiple messages via Lettermint batch API.
   *
   * @param messagesData The messages to send to Lettermint.
   * @param signal Optional AbortSignal for cancellation.
   * @param idempotencyKey Optional idempotency key for request deduplication.
   * @returns Promise that resolves to the Lettermint batch response.
   */
  sendBatch(messagesData, signal, idempotencyKey) {
    const url = `${this.config.baseUrl}/v1/send/batch`;
    return this.makeRequest(url, messagesData, signal, idempotencyKey);
  }

  async makeRequest(url, body, signal, idempotencyKey) {
    let lastError = null;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      signal?.throwIfAborted();

      try {
        const response = await this.fetchWithAuth(url, body, signal, idempotencyKey);
        const text = await response.text();

        if (!response.ok) {
          throw new LettermintApiError(
            parseErrorMessage(text, response.status),
            response.status,
            parseRetryAfter(response.headers.get('Retry-After')),
            attempt + 1,
          );
        }

        try {
          return JSON.parse(text);
        } catch (error) {
          throw new SyntaxError(
            `Invalid JSON response from Lettermint API: ${
              error instanceof Error ? error.message : String(error)
            }.`,
          );
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof LettermintApiError && !isRetryable(error)) {
          throw error;
        }

        if (error instanceof Error && error.name === 'AbortError' && signal?.aborted) {
          throw error;
        }

        if (attempt === this.config.retries) {
          throw withAttempts(lastError, attempt + 1);
        }

        await sleep(calculateRetryDelay(attempt), signal);
      }
    }

    throw lastError ?? new Error('Request failed after all retry attempts.');
  }

  async fetchWithAuth(url, body, signal, idempotencyKey) {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'x-lettermint-token': this.config.apiToken,
    });

    if (idempotencyKey) {
      headers.set('Idempotency-Key', idempotencyKey);
    }

    for (const [key, value] of Object.entries(this.config.headers)) {
      headers.set(key, value);
    }

    const timeoutController = new AbortController();
    const timeoutId =
      this.config.timeout > 0
        ? setTimeout(() => timeoutController.abort(), this.config.timeout)
        : undefined;
    const requestSignal = combineSignals(timeoutController.signal, signal);

    try {
      return await globalThis.fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: requestSignal.signal,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'AbortError' &&
        timeoutController.signal.aborted &&
        !signal?.aborted
      ) {
        throw new LettermintTimeoutError(this.config.timeout);
      }
      throw error;
    } finally {
      requestSignal.cleanup();
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }
}

const withAttempts = (error, attempts) => {
  if (error instanceof LettermintTimeoutError) {
    return new LettermintTimeoutError(error.timeout, attempts);
  }
  if (error instanceof LettermintApiError) {
    return error;
  }
  return Object.assign(error, { attempts });
};

const isRetryable = (error) => {
  return error.statusCode === 408 || error.statusCode === 429 || error.statusCode >= 500;
};

const calculateRetryDelay = (attempt) => {
  const baseDelay = Math.min(1000 * Math.pow(2, attempt), 10000);
  return Math.round(baseDelay / 2 + Math.random() * (baseDelay / 2));
};

const parseErrorMessage = (text, statusCode) => {
  try {
    const errorBody = JSON.parse(text);
    if (typeof errorBody.message === 'string' && errorBody.message !== '') {
      return errorBody.message;
    }
    if (typeof errorBody.error === 'string' && errorBody.error !== '') {
      return errorBody.error;
    }
    if (Array.isArray(errorBody.errors) && errorBody.errors.length > 0) {
      return JSON.stringify(errorBody.errors);
    }
  } catch {
    // Ignore if JSON parsing fails, as the body may be non-JSON.
  }

  return text || `HTTP ${statusCode}`;
};

const sleep = (ms, signal) => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

module.exports = { LettermintApiError, LettermintTimeoutError, LettermintHttpClient };
