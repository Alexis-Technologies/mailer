// Ported from upyo v0.7.0 (packages/ses/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee

const { createHash, createHmac } = require('node:crypto');
const { parseRetryAfter } = require('../core/receipt.js');
const { requestWithRetry } = require('../internal/http.js');
const { readText } = require('../internal/body.js');

class SesHttpClient {
  config;
  #signingKey = null;

  constructor(config) {
    this.config = config;
  }

  sendMessage(messageData, signal, onRetry) {
    const region = this.config.region;
    const url = `https://email.${region}.amazonaws.com/v2/email/outbound-emails`;

    return this.makeRequest(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messageData),
        signal,
      },
      onRetry,
    );
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
  makeRequest(url, options, onRetry) {
    return requestWithRetry({
      signal: options.signal,
      onRetry,
      retries: this.config.retries,
      timeoutMs: this.config.timeout,
      send: (signal) => this.fetchWithAuth(url, options, signal),
      read: async (response, attempt) => {
        const text = await readText(response);
        if (response.status !== 200) throw createSesApiError(response, text, attempt);
        return {
          statusCode: response.status,
          body: text,
          headers: this.headersToRecord(response.headers),
        };
      },
      reject: async (response, attempt) =>
        createSesApiError(response, await readText(response), attempt),
      createTimeoutError: () =>
        new Error(`SES API request timed out after ${this.config.timeout} ms.`),
      finalError: (error, attempts) =>
        error instanceof SesApiError
          ? error
          : new SesApiError(error.message, undefined, undefined, undefined, attempts, {
              cause: error,
            }),
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

    const signedHeaders = this.signRequest(
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

    // A redirect comes back as a response rather than being followed, so the
    // credentials in the headers never reach another origin.
    return await globalThis.fetch(url, {
      ...options,
      headers: this.headersToRecord(signedHeaders),
      signal,
      redirect: 'manual',
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

  /**
   * Signs a request with AWS Signature Version 4.
   *
   * @param url The URL of the request.
   * @param options The method, headers and body of the request.
   * @param credentials The access key, secret key and session token.
   * @param service The AWS service the request goes to.
   * @returns The headers of the request, with the signature.
   */
  signRequest(url, options, credentials, service = 'ses') {
    const parsedUrl = new URL(url);
    const method = options.method || 'GET';
    const headers = new Headers(options.headers);

    const host = parsedUrl.host;
    const path = parsedUrl.pathname + parsedUrl.search;
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

    const payloadHash = sha256Hex(options.body || '');
    const canonicalRequest = `${method}\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

    const signingKey = this.getSigningKey(credentials.secretAccessKey, credentialScope);
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const authorizationHeader = `${algorithm} Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    headers.set('Authorization', authorizationHeader);

    return headers;
  }

  // The signing key depends only on the secret and the scope (a day, a
  // region, a service), so it is derived once a day rather than per request.
  getSigningKey(secretAccessKey, credentialScope) {
    const cached = this.#signingKey;
    if (cached?.scope === credentialScope && cached.secretAccessKey === secretAccessKey) {
      return cached.key;
    }
    let key = `AWS4${secretAccessKey}`;
    for (const part of credentialScope.split('/')) {
      key = createHmac('sha256', key).update(part).digest();
    }
    this.#signingKey = { scope: credentialScope, secretAccessKey, key };
    return key;
  }

  headersToRecord(headers) {
    const record = {};
    for (const [key, value] of headers.entries()) {
      record[key] = value;
    }
    return record;
  }
}

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');

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

class SesApiError extends Error {
  statusCode;
  errors;
  retryAfterMilliseconds;
  attempts;

  constructor(message, statusCode, errors, retryAfterMilliseconds, attempts, options) {
    super(message, options);
    this.name = 'SesApiError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.retryAfterMilliseconds = retryAfterMilliseconds;
    this.attempts = attempts;
  }
}

module.exports = { SesHttpClient, SesApiError };
