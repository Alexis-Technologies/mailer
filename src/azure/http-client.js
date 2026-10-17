// Ported from unemail v0.7.0 (src/drivers/azure-communication.ts): the signed
// requests of the Email API of Azure Communication Services, and the category
// of its error codes.
// https://github.com/productdevbook/unemail — MIT, Copyright 2025 Wind
// Changed in the port: through the shared client of the HTTP providers; and a
// send carries the Repeatability-Request-Id and Repeatability-First-Sent of
// OASIS Repeatable Requests, by which Azure answers a repeat with the outcome
// of the first request rather than sending again.

const { createApiClient } = require('../internal/api.js');
const { signRequest } = require('./sign.js');

// Azure's codes that mean the key may not do this, whatever the status.
const AUTH_CODES = /Unauthorized|Unauthenticated|Forbidden|DenyAction|AuthenticationFailed/i;
const THROTTLE_CODES = /TooManyRequests|Throttl|QuotaExceeded/i;

const classify = (_status, json) => {
  const code = json?.error?.code;
  if (typeof code !== 'string' || code === '') return undefined;
  let classified = {};
  if (AUTH_CODES.test(code)) classified = { category: 'auth', retryable: false };
  else if (THROTTLE_CODES.test(code)) classified = { category: 'rate-limit', retryable: true };
  return { ...classified, code: `azure.${code}` };
};

/**
 * The client of the Email API of Azure Communication Services.
 *
 * @internal
 */
const createAzureClient = (config) => {
  const client = createApiClient(config, {
    id: 'azure',
    label: 'Azure Communication Services',
    // Each attempt is signed anew, with the time it is sent.
    authorize: (headers, request) => {
      const signed = signRequest({ ...request, date: new Date(config.now()) }, config.accessKey);
      for (const name in signed) headers.set(name, signed[name]);
    },
    classify,
  });
  return {
    ...client,
    /**
     * Sends a message.  `requestId` is a UUID, the operation's id and the key
     * of its repeats; `firstSent`, the time of the first attempt.
     */
    send: (payload, requestId, firstSent, options) =>
      client.request({
        url: `${config.endpoint}/emails:send?api-version=${config.apiVersion}`,
        body: payload,
        headers: {
          'Operation-Id': requestId,
          'Repeatability-Request-Id': requestId,
          'Repeatability-First-Sent': firstSent.toUTCString(),
        },
        hasIdempotencyKey: true,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { createAzureClient };
