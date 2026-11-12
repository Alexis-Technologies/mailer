// Ported from @thinwrap/notifications v1.2.0 (src/providers/fcm/fcm.connector.ts):
// the request of messages:send of FCM HTTP v1, its answer `name`, and the
// categories of its statuses.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Changed in the port: through the shared client of the HTTP providers, so a
// redirect is not followed, the body is bounded, and a send is never retried
// after a timeout or a lost answer, after which FCM may have taken it (FB1,
// firebase-admin `src/utils/api-request.ts`); the token of the service
// account is held and shared (internal/google-auth.js) rather than made for
// every send (T3), and dropped when FCM refuses it; and an error is told by
// the `errorCode` of its FcmError first, then its status (T5), the table of
// codes from FCM's documentation, as firebase-admin is Apache-2.0.

const { createApiClient } = require('../internal/api-client.js');
const { createGoogleAuth } = require('../internal/google-auth.js');

const SCOPES = ['https://www.googleapis.com/auth/firebase.messaging'];
// The ErrorCode of an FcmError
// (https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode).
const ERROR_CODES = new Map([
  ['UNREGISTERED', ['unregistered', false]],
  ['SENDER_ID_MISMATCH', ['invalid-recipient', false]],
  ['QUOTA_EXCEEDED', ['rate-limit', true]],
  ['UNAVAILABLE', ['service-unavailable', true]],
  ['INTERNAL', ['server-error', true]],
  ['THIRD_PARTY_AUTH_ERROR', ['configuration', false]],
  ['INVALID_ARGUMENT', ['validation', false]],
]);
// The status of a google.rpc.Status, when no FcmError says more.
const STATUSES = new Map([
  ['UNAUTHENTICATED', ['auth', false]],
  ['PERMISSION_DENIED', ['auth', false]],
  ['NOT_FOUND', ['configuration', false]],
  ['RESOURCE_EXHAUSTED', ['rate-limit', true]],
  ['INVALID_ARGUMENT', ['validation', false]],
  ['UNAVAILABLE', ['service-unavailable', true]],
  ['INTERNAL', ['server-error', true]],
]);

// The details of an error: its FcmError, and whether a field violation
// names the token of the message, which FCM refuses as an argument.
const detailsOf = (details) => {
  let errorCode;
  let badToken = false;
  if (!Array.isArray(details)) return { errorCode, badToken };
  for (const detail of details) {
    const type = typeof detail?.['@type'] === 'string' ? detail['@type'] : '';
    if (type.endsWith('google.firebase.fcm.v1.FcmError') && typeof detail.errorCode === 'string') {
      errorCode = detail.errorCode;
    }
    if (type.endsWith('google.rpc.BadRequest') && Array.isArray(detail.fieldViolations)) {
      for (const violation of detail.fieldViolations) {
        if (violation?.field === 'message.token') badToken = true;
      }
    }
  }
  return { errorCode, badToken };
};

/**
 * The category of a refusal of FCM: by the `errorCode` of its FcmError, then
 * the status of its error, then its HTTP status.
 *
 * @internal
 */
const classifyFcm = (status, json) => {
  const error = json?.error;
  const { errorCode, badToken } = detailsOf(error?.details);
  // A token that is no token of FCM is a dead recipient, not a bad message.
  if (badToken && (errorCode === undefined || errorCode === 'INVALID_ARGUMENT')) {
    return { category: 'unregistered', retryable: false, code: 'fcm.INVALID_TOKEN' };
  }
  const named = ERROR_CODES.get(errorCode) ?? STATUSES.get(error?.status);
  if (named !== undefined) {
    return { category: named[0], retryable: named[1], code: `fcm.${errorCode ?? error.status}` };
  }
  if (status === 401) return { category: 'auth', retryable: false, code: 'fcm.http_401' };
  return undefined;
};

/**
 * The client of messages:send, with the token of the service account.
 *
 * @internal
 */
const createFcmClient = (config) => {
  const auth = createGoogleAuth({
    serviceAccount: config.serviceAccount,
    scopes: SCOPES,
    fetch: (url, init) => (config.fetch ?? globalThis.fetch)(url, init),
    tokenUrl: config.tokenUrl,
    // The token is bounded by the timeout of the transport, as its requests.
    timeout: config.timeout,
    now: config.now,
  });
  // A token FCM refuses is dropped, so that the next send asks for another.
  const fetch = async (url, init) => {
    const response = await (config.fetch ?? globalThis.fetch)(url, init);
    if (response.status === 401) {
      const token = new Headers(init.headers).get('authorization')?.slice('Bearer '.length);
      if (token !== undefined) auth.invalidate(token);
    }
    return response;
  };
  const client = createApiClient(
    { ...config, fetch },
    {
      refreshesToken: true,
      id: 'fcm',
      label: 'FCM',
      authorize: async (headers, { signal }) => {
        headers.set('Authorization', `Bearer ${await auth.token(signal)}`);
      },
      messageOf: (json) =>
        typeof json?.error?.message === 'string' ? json.error.message : undefined,
      classify: classifyFcm,
    },
  );
  const sendUrl = `${config.baseUrl}/v1/projects/${config.projectId}/messages:send`;
  return {
    ...client,
    sendUrl,
    send: (body, options) =>
      client.request({ url: sendUrl, body, signal: options?.signal, onRetry: options?.onRetry }),
  };
};

module.exports = { classifyFcm, createFcmClient };
