// Ported from upyo v0.7.0 (packages/ses/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { combineSignals } = require('../core/abort-signal.js');
const { parseRetryAfter } = require('../core/receipt.js');
const { markDeliveryUnknown } = require('../internal/delivery-unknown.js');

class SesHttpClient {
  config;

  constructor(config) {
    this.config = config;
  }

  sendMessage(messageData, signal) {
    const region = this.config.region;
    const url = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;

    return this.makeRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messageData),
      signal,
    });
  }

  /**
   * Makes an HTTP request to the SES API with retry logic.
   *
   * @param url The URL to make the request to.
   * @param options Fetch options.
   * @returns Promise that resolves to the parsed response.
   * @throws {DOMException} If the caller aborts the request.
   * @throws {SesApiError} If SES returns a client error or all retry attempts
   *                       are exhausted.
   */
  async makeRequest(url, options) {
    let lastError = null;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      let isAccepted = false;
      try {
        const response = await this.fetchWithAuth(url, options);
        isAccepted = response.ok;
        const text = await response.text();

        if (response.status === 200) {
          return {
            statusCode: response.status,
            body: text,
            headers: this.headersToRecord(response.headers),
          };
        }

        let errorData;
        try {
          errorData = JSON.parse(text);
        } catch {
          errorData = { message: text || `HTTP ${response.status}` };
        }

        throw new SesApiError(
          errorData.message || `HTTP ${response.status}`,
          response.status,
          errorData.errors,
          parseRetryAfter(response.headers.get('Retry-After')),
          attempt + 1,
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (options.signal?.aborted) {
          throw createAbortError(options.signal);
        }

        // A 2xx means the provider took the request: sending it again could
        // deliver the message twice, so what fails after it is not retried.
        if (isAccepted) throw markDeliveryUnknown(lastError);

        if (isAbortError(error)) {
          throw error;
        }

        if (
          error instanceof SesApiError &&
          error.statusCode &&
          error.statusCode >= 400 &&
          error.statusCode < 500
        ) {
          throw error;
        }

        if (attempt === this.config.retries) {
          if (lastError instanceof SesApiError) {
            throw lastError;
          }
          throw new SesApiError(lastError.message, undefined, undefined, undefined, attempt + 1);
        }

        const delay = Math.pow(2, attempt) * 1000;
        await sleep(delay, options.signal);
      }
    }

    throw lastError || new Error('Request failed after all retries');
  }

  /**
   * Makes a signed fetch request to the SES API.
   *
   * @param url The URL to make the request to.
   * @param options Fetch options.
   * @returns Promise that resolves to the fetch response.
   * @throws {Error} If the configured request timeout is reached.
   * @throws {DOMException} If the caller aborts the request.
   */
  async fetchWithAuth(url, options) {
    const credentials = await this.getCredentials();
    const headers = new Headers(options.headers);

    const signedHeaders = await this.signRequest(
      url,
      {
        ...options,
        headers,
      },
      credentials,
    );

    for (const [key, value] of Object.entries(this.config.headers)) {
      signedHeaders.set(key, value);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    const combinedSignal = combineSignals(controller.signal, options.signal);

    try {
      return await globalThis.fetch(url, {
        ...options,
        headers: this.headersToRecord(signedHeaders),
        signal: combinedSignal.signal,
      });
    } catch (error) {
      if (isAbortError(error) && controller.signal.aborted && !options.signal?.aborted) {
        // oxlint-disable-next-line preserve-caught-error -- upstream
        throw new Error(`SES API request timed out after ${this.config.timeout} ms.`);
      }
      throw error;
    } finally {
      combinedSignal.cleanup();
      clearTimeout(timeoutId);
    }
  }

  async getCredentials() {
    const auth = this.config.authentication;

    switch (auth.type) {
      case 'credentials':
        return {
          accessKeyId: auth.accessKeyId,
          secretAccessKey: auth.secretAccessKey,
        };

      case 'session':
        return {
          accessKeyId: auth.accessKeyId,
          secretAccessKey: auth.secretAccessKey,
          sessionToken: auth.sessionToken,
        };

      default:
        throw new Error(`Unsupported authentication type: ${auth.type}`);
    }
  }

  async signRequest(url, options, credentials) {
    const parsedUrl = new URL(url);
    const method = options.method || 'GET';
    const headers = new Headers(options.headers);

    const host = parsedUrl.host;
    const path = parsedUrl.pathname + parsedUrl.search;
    const service = 'ses';
    const region = this.config.region;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);

    headers.set('Host', host);
    headers.set('X-Amz-Date', amzDate);

    if (credentials.sessionToken) {
      headers.set('X-Amz-Security-Token', credentials.sessionToken);
    }

    const signedHeaders =
      'host;x-amz-date' + (credentials.sessionToken ? ';x-amz-security-token' : '');
    const canonicalHeaders =
      `host:${host}\nx-amz-date:${amzDate}\n` +
      (credentials.sessionToken ? `x-amz-security-token:${credentials.sessionToken}\n` : '');

    const payloadHash = await this.sha256(options.body || '');
    const canonicalRequest = `${method}\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${await this.sha256(
      canonicalRequest,
    )}`;

    const signingKey = await this.getSignatureKey(
      credentials.secretAccessKey,
      dateStamp,
      region,
      service,
    );
    const signature = await this.hmacSha256(signingKey, stringToSign);

    const authorizationHeader = `${algorithm} Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    headers.set('Authorization', authorizationHeader);

    return headers;
  }

  async sha256(data) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async hmacSha256(key, data) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBuffer);
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async getSignatureKey(key, dateStamp, regionName, serviceName) {
    const encoder = new TextEncoder();

    let keyBuffer = new Uint8Array(encoder.encode('AWS4' + key)).buffer;
    keyBuffer = await this.hmacSha256Buffer(keyBuffer, dateStamp);
    keyBuffer = await this.hmacSha256Buffer(keyBuffer, regionName);
    keyBuffer = await this.hmacSha256Buffer(keyBuffer, serviceName);
    keyBuffer = await this.hmacSha256Buffer(keyBuffer, 'aws4_request');

    return keyBuffer;
  }

  async hmacSha256Buffer(key, data) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return await crypto.subtle.sign('HMAC', cryptoKey, dataBuffer);
  }

  headersToRecord(headers) {
    const record = {};
    for (const [key, value] of headers.entries()) {
      record[key] = value;
    }
    return record;
  }
}

const isAbortError = (error) => {
  return error instanceof Error && error.name === 'AbortError';
};

const sleep = (milliseconds, signal) => {
  if (signal?.aborted) {
    return Promise.reject(createAbortError(signal));
  }

  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abort);
      reject(createAbortError(signal));
    };

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);

    signal?.addEventListener('abort', abort, { once: true });
  });
};

const createAbortError = (signal) => {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
};

class SesApiError extends Error {
  statusCode;
  errors;
  retryAfterMilliseconds;
  attempts;

  constructor(message, statusCode, errors, retryAfterMilliseconds, attempts) {
    super(message);
    this.name = 'SesApiError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.retryAfterMilliseconds = retryAfterMilliseconds;
    this.attempts = attempts;
  }
}

module.exports = { SesHttpClient, SesApiError };
