// Ported from @thinwrap/notifications v1.2.0 (src/providers/infobip/infobip.connector.ts):
// the request of `/sms/3/messages` with the `App` key of Infobip, and the
// categories of a status of the group REJECTED in its 200 by the name of the
// status.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: through the shared client of the HTTP providers, so a
// redirect is not followed, the body is bounded, and a send is never retried
// after a lost answer; a recipient of DND is `opted-out` and a sender or the
// credits of the account `configuration`, where thinwrap made them an
// invalid recipient and an invalid request.

const { createApiClient } = require('../internal/api-client.js');

// The words of the name of a status of the group REJECTED, and what each says.
const REJECTIONS = [
  ['DND', 'opted-out'],
  ['FLOODING', 'rate-limit'],
  ['CREDITS', 'configuration'],
  ['PREPAID', 'configuration'],
  ['SENDER', 'configuration'],
  ['SOURCE', 'configuration'],
  ['ROUTE', 'configuration'],
  ['NETWORK', 'configuration'],
  ['NOT_REGISTERED', 'configuration'],
  ['DESTINATION', 'invalid-recipient'],
  ['PREFIX', 'invalid-recipient'],
  ['MISSING_TO', 'invalid-recipient'],
  ['TOO_LONG', 'validation'],
  ['UDH', 'validation'],
  ['SYSTEM_ERROR', 'server-error'],
];
const RETRYABLE = new Set(['rate-limit', 'server-error']);
const STATUSES = new Map([
  [400, 'validation'],
  [401, 'auth'],
  [403, 'configuration'],
  [429, 'rate-limit'],
]);

// The groups of a status of a message that did not go: UNDELIVERABLE (2),
// EXPIRED (4) and REJECTED (5), by id or by name.
const FAILED_GROUPS = new Set([2, 4, 5]);
const FAILED_GROUP_NAMES = new Set(['UNDELIVERABLE', 'EXPIRED', 'REJECTED']);

/**
 * Whether the status Infobip gave a message in its 200 is a refusal.
 *
 * @internal
 */
const isFailedStatus = (status) =>
  FAILED_GROUPS.has(status?.groupId) || FAILED_GROUP_NAMES.has(status?.groupName);

/**
 * The category of a status of a message that did not go, by the words of
 * its name, `rejected` for one they do not tell.
 *
 * @internal
 */
const classifyStatus = (status) => {
  const name = typeof status?.name === 'string' ? status.name.toUpperCase() : '';
  let category = 'rejected';
  for (const [word, named] of REJECTIONS) {
    if (name.includes(word)) {
      category = named;
      break;
    }
  }
  return { category, retryable: RETRYABLE.has(category), code: `infobip.${name || 'REJECTED'}` };
};

// The message and the code of an error answer, of v3
// (`{ errorCode, description }`) or of the older shape
// (`{ requestError: { serviceException: { messageId, text } } }`).
const messageOf = (json) => {
  const text = json?.description ?? json?.requestError?.serviceException?.text;
  return typeof text === 'string' ? text : undefined;
};
const codeOf = (json, status) => {
  const code = json?.errorCode ?? json?.requestError?.serviceException?.messageId;
  return `infobip.${typeof code === 'string' ? code : `http_${status}`}`;
};

/**
 * The client of the SMS API.
 *
 * @internal
 */
const createInfobipClient = (config) => {
  const client = createApiClient(config, {
    id: 'infobip',
    label: 'Infobip',
    authorize: (headers) => headers.set('Authorization', `App ${config.apiKey}`),
    messageOf,
    classify: (status, json) => {
      const category = STATUSES.get(status) ?? (status >= 500 ? 'server-error' : undefined);
      return {
        category,
        retryable: category === undefined ? undefined : RETRYABLE.has(category),
        code: codeOf(json, status),
      };
    },
    // A 500 or a 502 may come once the SMS was taken, which no key dedupes
    // (C44): of unknown delivery; a 503 took nothing and is sent again.
    isAmbiguousStatus: (status) => status === 500 || status === 502,
  });
  return {
    ...client,
    balanceUrl: `${config.baseUrl}/account/1/balance`,
    send: (body, options) =>
      client.request({
        url: `${config.baseUrl}/sms/3/messages`,
        body,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
  };
};

module.exports = { classifyStatus, createInfobipClient, isFailedStatus };
