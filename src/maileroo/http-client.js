// Ported from upyo v0.7.0 (packages/maileroo/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { combineSignals } = require('../core/abort-signal.js');
const { parseRetryAfter } = require('../core/receipt.js');

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

  async makeRequest(url, body, signal) {
    let lastError;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      signal?.throwIfAborted();

      let responseText;
      try {
        const { response, text } = await this.fetchWithAuth(url, body, signal);

        if (!response.ok) {
          throw new MailerooApiError(
            parseErrorMessage(text, response.status),
            response.status,
            parseRetryAfter(response.headers.get('Retry-After')),
            attempt + 1,
          );
        }

        responseText = text;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (signal?.aborted) {
          throw error;
        }

        if (error instanceof MailerooApiError && !isRetryable(error)) {
          throw error;
        }

        if (attempt === this.config.retries) {
          throw withAttempts(lastError, attempt + 1);
        }

        await sleep(calculateRetryDelay(attempt, lastError), signal);
        continue;
      }

      return parseResponse(responseText);
    }

    throw lastError ?? new Error('Request failed after all retry attempts.');
  }

  async fetchWithAuth(url, body, signal) {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'X-API-Key': this.config.apiKey,
    });

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
      const response = await globalThis.fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: requestSignal.signal,
      });
      const text = await response.text();
      return { response, text };
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'AbortError' &&
        timeoutController.signal.aborted &&
        !signal?.aborted
      ) {
        throw new MailerooTimeoutError(this.config.timeout);
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
  const baseDelay = Math.min(1000 * Math.pow(2, attempt), 10000);
  const backoffDelay = Math.round(baseDelay / 2 + Math.random() * (baseDelay / 2));
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

const abortReason = (signal) => {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
};

const sleep = (ms, signal) => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }

    const timeoutState = {};
    const onAbort = () => {
      if (timeoutState.id !== undefined) {
        clearTimeout(timeoutState.id);
      }
      signal?.removeEventListener('abort', onAbort);
      reject(abortReason(signal));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    if (signal?.aborted) {
      onAbort();
      return;
    }

    timeoutState.id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
  });
};

module.exports = { MailerooApiError, MailerooTimeoutError, MailerooHttpClient };
