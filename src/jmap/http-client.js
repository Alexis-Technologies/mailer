// Ported from upyo v0.7.0 (packages/jmap/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { parseRetryAfter } = require('../core/receipt.js');
const { JmapApiError } = require('./errors.js');
const { exponentialDelayMs, isAbortError, requestWithRetry } = require('../internal/http.js');

/**
 * HTTP client for JMAP API requests.
 */
class JmapHttpClient {
  config;
  replayableRequests;

  /**
   * @param config HTTP and authentication settings.
   * @param replayableRequests Whether request bodies and failed requests may be replayed.
   */
  constructor(config, replayableRequests = true) {
    this.config = config;
    this.replayableRequests = replayableRequests;
  }

  /**
   * Fetches the JMAP session from the session URL.
   * @param signal Optional abort signal.
   * @returns The JMAP session response.
   */
  fetchSession(signal) {
    signal?.throwIfAborted();

    return requestWithRetry({
      signal,
      retries: 0,
      timeoutMs: this.config.timeout,
      isIdempotent: true,
      send: (attemptSignal) =>
        this.fetchWithAuth(this.config.sessionUrl, { method: 'GET' }, attemptSignal),
      read: (response) => response.json(),
      reject: async (response) =>
        new JmapApiError(
          `Session fetch failed: ${response.status}`,
          response.status,
          await response.text(),
          undefined,
          parseRetryAfter(response.headers.get('Retry-After')),
          1,
        ),
      isRetryable: () => true,
      retryDelayMs: exponentialDelayMs,
    });
  }

  /**
   * Executes a JMAP API request.
   * @param apiUrl The JMAP API URL.
   * @param request The JMAP request payload.
   * @param signal Optional abort signal.
   * @returns The JMAP response.
   */
  executeRequest(apiUrl, request, signal) {
    signal?.throwIfAborted();

    return requestWithRetry({
      signal,
      retries: this.replayableRequests ? this.config.retries : 0,
      timeoutMs: this.config.timeout,
      // A JMAP request is retried after a 2xx it could not read, as upstream
      // did; the submission of an email has no retries (`submissionClient`).
      isIdempotent: true,
      send: (attemptSignal) =>
        this.fetchWithAuth(
          apiUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // A stream prevents runtime-level replay of a POST after a lost
            // response (observed with Deno even when application retries are 0).
            body: this.replayableRequests
              ? JSON.stringify(request)
              : new ReadableStream({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode(JSON.stringify(request)));
                    controller.close();
                  },
                }),
            ...(this.replayableRequests ? {} : { duplex: 'half', redirect: 'error' }),
          },
          attemptSignal,
        ),
      read: (response) => response.json(),
      reject: async (response, attempt) =>
        new JmapApiError(
          `JMAP request failed: ${response.status}`,
          response.status,
          await response.text(),
          undefined,
          parseRetryAfter(response.headers.get('Retry-After')),
          attempt + 1,
        ),
      // Don't retry on 4xx errors (client errors)
      isRetryable: (error) =>
        !(error instanceof JmapApiError && error.statusCode >= 400 && error.statusCode < 500),
      retryDelayMs: exponentialDelayMs,
      // The cause tells a request that never left (a refused connection) from
      // one that may have reached the server.
      finalError: (error, attempts) => {
        if (error instanceof JmapApiError) return error;
        const message = isAbortError(error) ? 'JMAP request timed out.' : error.message;
        return new JmapApiError(message, undefined, undefined, undefined, undefined, attempts, {
          cause: error,
        });
      },
    });
  }

  /**
   * Makes an authenticated fetch request.
   * @param url The URL to fetch.
   * @param options Fetch options.
   * @param signal The signal of the attempt, with its deadline.
   * @returns The fetch response.
   */
  fetchWithAuth(url, options, signal) {
    const headers = new Headers(options.headers);
    if (this.config.bearerToken) {
      headers.set('Authorization', `Bearer ${this.config.bearerToken}`);
    } else if (this.config.basicAuth) {
      const credentials = btoa(
        `${this.config.basicAuth.username}:${this.config.basicAuth.password}`,
      );
      headers.set('Authorization', `Basic ${credentials}`);
    }

    // Add custom headers from config
    for (const [key, value] of Object.entries(this.config.headers)) {
      headers.set(key, value);
    }

    return globalThis.fetch(url, { ...options, headers, signal });
  }
}

module.exports = { JmapHttpClient };
