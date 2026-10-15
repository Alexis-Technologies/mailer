// Ported from upyo v0.7.0 (packages/jmap/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { parseRetryAfter } = require('../core/receipt.js');
const { JmapApiError } = require('./errors.js');

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
  async fetchSession(signal) {
    signal?.throwIfAborted();

    const response = await this.fetchWithAuth(this.config.sessionUrl, { method: 'GET' }, signal);

    if (!response.ok) {
      const text = await response.text();
      throw new JmapApiError(
        `Session fetch failed: ${response.status}`,
        response.status,
        text,
        undefined,
        parseRetryAfter(response.headers.get('Retry-After')),
        1,
      );
    }

    return await response.json();
  }

  /**
   * Executes a JMAP API request.
   * @param apiUrl The JMAP API URL.
   * @param request The JMAP request payload.
   * @param signal Optional abort signal.
   * @returns The JMAP response.
   */
  async executeRequest(apiUrl, request, signal) {
    signal?.throwIfAborted();

    let lastError = null;

    const retries = this.replayableRequests ? this.config.retries : 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      signal?.throwIfAborted();

      try {
        const response = await this.fetchWithAuth(
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
          signal,
        );

        if (!response.ok) {
          const text = await response.text();
          const error = new JmapApiError(
            `JMAP request failed: ${response.status}`,
            response.status,
            text,
            undefined,
            parseRetryAfter(response.headers.get('Retry-After')),
            attempt + 1,
          );

          // Don't retry on 4xx errors (client errors)
          if (response.status >= 400 && response.status < 500) {
            throw error;
          }

          throw error;
        }

        return await response.json();
      } catch (error) {
        // Don't retry if aborted
        if (isCallerAbort(error, signal)) {
          throw error;
        }

        // Don't retry on 4xx errors
        if (error instanceof JmapApiError && error.statusCode !== undefined) {
          if (error.statusCode >= 400 && error.statusCode < 500) {
            throw error;
          }
        }

        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === retries) {
          if (error instanceof JmapApiError) {
            throw error;
          }
          // The cause tells a request that never left (a refused connection)
          // from one that may have reached the server.
          if (isAbortError(error)) {
            throw new JmapApiError(
              'JMAP request timed out.',
              undefined,
              undefined,
              undefined,
              undefined,
              attempt + 1,
              { cause: error },
            );
          }
          throw new JmapApiError(
            lastError.message,
            undefined,
            undefined,
            undefined,
            undefined,
            attempt + 1,
            { cause: error },
          );
        }

        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
          };
          const onAbort = () => {
            cleanup();
            reject(signal?.reason);
          };
          const timer = setTimeout(() => {
            cleanup();
            resolve();
          }, delay);
          signal?.addEventListener('abort', onAbort, { once: true });
          if (signal?.aborted) onAbort();
        });
      }
    }

    if (lastError != null) {
      throw lastError;
    }
    throw new Error('Request failed after all retries');
  }

  /**
   * Makes an authenticated fetch request.
   * @param url The URL to fetch.
   * @param options Fetch options.
   * @param signal Optional abort signal.
   * @returns The fetch response.
   */
  async fetchWithAuth(url, options, signal) {
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

    // Setup timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    // Combine with external signal if provided
    let combinedSignal = controller.signal;
    if (signal) {
      combinedSignal = AbortSignal.any([signal, controller.signal]);
    }

    try {
      return await globalThis.fetch(url, {
        ...options,
        headers,
        signal: combinedSignal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

const isCallerAbort = (error, signal) => {
  return signal?.aborted === true && (isAbortError(error) || error === signal.reason);
};

const isAbortError = (error) => {
  return error instanceof Error && error.name === 'AbortError';
};

module.exports = { JmapHttpClient };
