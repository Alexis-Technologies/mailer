// Ported from upyo v0.7.0 (packages/ses/src/http-client.ts)
// https://github.com/dahlia/upyo — MIT, Copyright 2025 Hong Minhee
// Changed after the port: the request goes through createApiClient of
// internal/api-client.js, as that of every HTTP provider does, its SigV4
// signature made by the authorize of each attempt (internal/sigv4.js, which
// every service of AWS shares), and SesApiError extends its error; the
// messages and the errors of upstream stay.

const { parseRetryAfter } = require('../core/receipt.js');
const { ProviderApiError, createApiClient } = require('../internal/api-client.js');
const { createSigV4Signer } = require('../internal/sigv4.js');

class SesHttpClient {
  config;
  #request;
  #sign;

  constructor(config) {
    this.config = config;
    this.#sign = createSigV4Signer(config.region, 'ses');
    const client = createApiClient(config, {
      id: 'ses',
      label: 'SES',
      // Each attempt is signed anew: X-Amz-Date is the time of the attempt.
      authorize: async (headers, request) => {
        const credentials = await this.getCredentials();
        const signed = this.signRequest(
          request.url,
          { method: request.method, headers, body: request.body },
          credentials,
        );
        for (const [name, value] of signed) headers.set(name, value);
      },
      read: (response, text, attempt) => {
        if (response.status !== 200) throw createSesApiError(response, text, attempt);
        return {
          statusCode: response.status,
          body: text,
          headers: this.headersToRecord(response.headers),
        };
      },
      reject: (response, text, attempt) => createSesApiError(response, text ?? '', attempt),
      timeoutError: () => new Error(`SES API request timed out after ${config.timeout} ms.`),
      finalError: (error, attempts) =>
        error instanceof SesApiError
          ? error
          : new SesApiError(error.message, undefined, undefined, undefined, attempts, {
              cause: error,
            }),
    });
    this.log = client.log;
    this.fetchWithAuth = client.fetchWithAuth;
    this.#request = client.request;
  }

  /**
   * Sends a message through the SES v2 API.
   *
   * @param messageData The JSON data of SendEmail.
   * @param signal Optional AbortSignal for cancellation.
   * @param onRetry Optional callback told of each retry.
   * @returns Promise that resolves to the SES response.
   * @throws {DOMException} If the caller aborts the request.
   * @throws {SesApiError} If SES returns a client error or all retry attempts
   *                       are exhausted.
   */
  sendMessage(messageData, signal, onRetry) {
    const url = `https://email.${this.config.region}.amazonaws.com/v2/email/outbound-emails`;
    return this.#request({ url, body: messageData, signal, onRetry });
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
    return this.#sign(url, options, credentials, service);
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

class SesApiError extends ProviderApiError {
  errors;

  constructor(message, statusCode, errors, retryAfterMilliseconds, attempts, options) {
    super('ses', message, {
      statusCode,
      retryAfterMilliseconds,
      attempts,
      cause: options?.cause,
      providerDetails: errors,
    });
    this.name = 'SesApiError';
    this.errors = errors;
  }
}

module.exports = { SesHttpClient, SesApiError };
