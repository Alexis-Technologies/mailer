// Ported from @thinwrap/notifications v1.2.0 (src/providers/vonage/vonage.connector.ts):
// the request of the SMS API of Vonage and the categories of the statuses of
// its messages, which it answers in a 200.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: through the shared client of the HTTP providers, so a
// redirect is not followed, the body is bounded, and a send is never retried
// after a lost answer; the account is read with Basic credentials rather
// than with its secret in the query of a URL.

const { Buffer } = require('node:buffer');
const { createApiClient } = require('../internal/api-client.js');

// The status of a message of the SMS API
// (https://developer.vonage.com/en/messaging/sms/guides/troubleshooting-sms).
const STATUSES = new Map([
  ['1', 'rate-limit'],
  ['2', 'validation'],
  ['3', 'validation'],
  ['4', 'auth'],
  ['5', 'server-error'],
  ['6', 'invalid-recipient'],
  ['7', 'opted-out'],
  ['8', 'configuration'],
  ['9', 'configuration'],
  ['10', 'rate-limit'],
  ['11', 'configuration'],
  ['12', 'validation'],
  ['14', 'auth'],
  ['15', 'configuration'],
  ['22', 'validation'],
  ['23', 'configuration'],
  ['29', 'configuration'],
  ['32', 'auth'],
  ['33', 'invalid-recipient'],
]);
const RETRYABLE = new Set(['rate-limit', 'server-error']);

/**
 * The category of the status of a message, `validation` for one Vonage does
 * not document.
 *
 * @internal
 */
const classifyStatus = (status) => {
  const category = STATUSES.get(status) ?? 'validation';
  return { category, retryable: RETRYABLE.has(category), code: `vonage.${status}` };
};

/**
 * The client of the SMS API and of the account.
 *
 * @internal
 */
const createVonageClient = (config) => {
  const basic = `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64')}`;
  const client = createApiClient(config, {
    id: 'vonage',
    label: 'Vonage',
    // The SMS API takes its credentials in the form; the account, Basic.
    authorize: (headers, { url }) => {
      if (url.includes('/account/')) headers.set('Authorization', basic);
    },
    messageOf: (json) =>
      typeof json?.['error-text'] === 'string' ? json['error-text'] : undefined,
    // A 500 or a 502 may come once the SMS was taken, which no key dedupes
    // (C44): of unknown delivery; a 503 took nothing and is sent again.
    isAmbiguousStatus: (status) => status === 500 || status === 502,
  });
  return {
    ...client,
    balanceUrl: `${config.baseUrl}/account/get-balance`,
    send: (form, options) =>
      client.request({
        url: `${config.baseUrl}/sms/json`,
        body: form,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { classifyStatus, createVonageClient };
