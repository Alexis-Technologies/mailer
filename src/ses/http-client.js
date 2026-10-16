// Ported from upyo v0.7.0 (packages/ses/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { parseRetryAfter } = require('../core/receipt.js');
const { exponentialDelayMs, isAbortError, requestWithRetry } = require('../internal/http.js');

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
  makeRequest(url, options) {
    return requestWithRetry({
      signal: options.signal,
      retries: this.config.retries,
      timeoutMs: this.config.timeout,
      send: (signal) => this.fetchWithAuth(url, options, signal),
      read: async (response, attempt) => {
        const text = await response.text();
        if (response.status !== 200) throw createSesApiError(response, text, attempt);
        return {
          statusCode: response.status,
          body: text,
          headers: this.headersToRecord(response.headers),
        };
      },
      reject: async (response, attempt) =>
        createSesApiError(response, await response.text(), attempt),
      createTimeoutError: () =>
        new Error(`SES API request timed out after ${this.config.timeout} ms.`),
      isRetryable: (error) => !isClientError(error) && !isAbortError(error),
      retryDelayMs: exponentialDelayMs,
      finalError: (error, attempts) =>
        error instanceof SesApiError
          ? error
          : new SesApiError(error.message, undefined, undefined, undefined, attempts),
    });
  }

  /**
   * Makes a signed fetch request to the SES API.
   *
   * @param url The URL to make the request to.
   * @param options Fetch options.
   * @param signal The signal of the attempt, with its deadline.
   * @returns Promise that resolves to the fetch response.
   */
  async fetchWithAuth(url, options, signal) {
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

    return await globalThis.fetch(url, {
      ...options,
      headers: this.headersToRecord(signedHeaders),
      signal,
    });
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

const createSesApiError = (response, text, attempt) => {
  let errorData;
  try {
    errorData = JSON.parse(text);
  } catch {
    errorData = { message: text || `HTTP ${response.status}` };
  }

  return new SesApiError(
    errorData.message || `HTTP ${response.status}`,
    response.status,
    errorData.errors,
    parseRetryAfter(response.headers.get('Retry-After')),
    attempt + 1,
  );
};

const isClientError = (error) =>
  error instanceof SesApiError && error.statusCode >= 400 && error.statusCode < 500;

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
