// Ported from @thinwrap/notifications v1.2.0 (src/providers/apns/apns.connector.ts):
// the request of /3/device/<token> of APNs with an ES256 token of the team
// (apns.auth.ts), and the categories of the reasons of its refusals.
// https://github.com/thinwrap/notifications-ts — MIT, Copyright 2026 Dmitry Polyanovsky & contributors
// Also ported from @parse/node-apn v8.1.1 (lib/client.js): the requests over
// one HTTP/2 session of the origin, through internal/http2.js.
// https://github.com/parse-community/node-apn — MIT, Copyright 2010 Andrew Naylor, Parse Platform
// Changed in the port: the token is held and shared, made anew before its
// hour is out, rather than signed for every send, which APNs answers with
// TooManyProviderTokenUpdates (T3); a token APNs answers ExpiredProviderToken
// is dropped and the send retried once with a new one, where thinwrap left
// the refused token to the application (T4); a 5xx is of unknown delivery,
// never retried, where node-apn retried a 500 and a 503 (AP1); and every
// reason has its category, where visulima passed it on as text (V15).

const { createApiClient } = require('../internal/api-client.js');
const { readText } = require('../internal/body.js');
const { createHttp2Fetch } = require('../internal/http2.js');
const { signJwt } = require('../internal/jwt.js');
const { createLog } = require('../internal/log.js');
const { createTokenCache } = require('../internal/token-cache.js');

// A token of APNs is good for an hour, and may change no more than once in
// twenty minutes: one is made for 55 minutes, anew five before their end.
const TOKEN_LIFETIME_MS = 55 * 60_000;
const MIN_TOKEN_AGE_MS = 20 * 60_000;
// The reasons of a refusal of APNs
// (https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns).
const REASONS = new Map([
  ['BadDeviceToken', 'invalid-recipient'],
  ['DeviceTokenNotForTopic', 'invalid-recipient'],
  ['Unregistered', 'unregistered'],
  ['ExpiredToken', 'unregistered'],
  ['BadTopic', 'configuration'],
  ['MissingTopic', 'configuration'],
  ['TopicDisallowed', 'configuration'],
  ['BadCertificateEnvironment', 'configuration'],
  ['BadPath', 'configuration'],
  ['MethodNotAllowed', 'configuration'],
  ['TooManyProviderTokenUpdates', 'configuration'],
  ['BadCertificate', 'auth'],
  ['ExpiredProviderToken', 'auth'],
  ['InvalidProviderToken', 'auth'],
  ['MissingProviderToken', 'auth'],
  ['Forbidden', 'auth'],
  ['TooManyRequests', 'rate-limit'],
  ['PayloadTooLarge', 'validation'],
  ['InternalServerError', 'server-error'],
  ['ServiceUnavailable', 'service-unavailable'],
  ['Shutdown', 'service-unavailable'],
]);
const STATUSES = new Map([
  [400, 'validation'],
  [403, 'auth'],
  [404, 'configuration'],
  [405, 'configuration'],
  [410, 'unregistered'],
  [413, 'validation'],
  [429, 'rate-limit'],
]);
const RETRYABLE = new Set(['rate-limit', 'server-error', 'service-unavailable']);
const EXPIRED_TOKEN = 'ExpiredProviderToken';

const reasonOf = (json) => (typeof json?.reason === 'string' ? json.reason : undefined);

/**
 * The category of a refusal of APNs: by its reason, then its status.  An
 * expired token is retried, with a new one.
 *
 * @internal
 */
const classifyApns = (status, json) => {
  const reason = reasonOf(json);
  const category =
    REASONS.get(reason) ?? STATUSES.get(status) ?? (status >= 500 ? 'server-error' : undefined);
  return {
    category,
    retryable:
      category === undefined ? undefined : reason === EXPIRED_TOKEN || RETRYABLE.has(category),
    code: `apns.${reason ?? `http_${status}`}`,
  };
};

/**
 * The client of the pushes of a team, over HTTP/2 unless `fetch` is given.
 *
 * @internal
 */
const createApnsClient = (config) => {
  const http2 =
    config.fetch === undefined
      ? createHttp2Fetch({
          tls: config.tls,
          pingIntervalMs: config.pingIntervalMs,
          pingTimeoutMs: config.pingTimeoutMs,
          log: createLog(config.logger, { transport: 'apns' }),
        })
      : undefined;
  const base = config.fetch ?? http2.fetch;
  let issued;
  const tokens = createTokenCache(
    async () => {
      const at = config.now();
      const token = signJwt(
        { alg: 'ES256', kid: config.keyId },
        { iss: config.teamId, iat: Math.floor(at / 1000) },
        config.privateKey,
      );
      issued = { token, at };
      return { token, expiresAt: at + TOKEN_LIFETIME_MS };
    },
    { now: config.now },
  );
  // A token APNs says expired is dropped, unless it is younger than the
  // twenty minutes between two tokens: a new one would be refused too.
  const fetch = async (url, init) => {
    const response = await base(url, init);
    if (response.status === 403 && issued !== undefined) {
      let reason;
      try {
        reason = JSON.parse(await readText(response.clone())).reason;
      } catch {
        reason = undefined;
      }
      const token = new Headers(init.headers).get('authorization')?.slice('bearer '.length);
      if (
        reason === EXPIRED_TOKEN &&
        token === issued.token &&
        config.now() - issued.at >= MIN_TOKEN_AGE_MS
      ) {
        tokens.invalidate(token);
      }
    }
    return response;
  };
  const client = createApiClient(
    { ...config, fetch },
    {
      id: 'apns',
      label: 'APNs',
      authorize: async (headers, { signal }) => {
        headers.set('authorization', `bearer ${await tokens.get(signal)}`);
      },
      messageOf: reasonOf,
      classify: classifyApns,
      // A 5xx may come after APNs took the push (AP1).
      isAmbiguousStatus: (status) => status >= 500,
    },
  );
  return {
    ...client,
    send: (push, options) =>
      client.request({
        url: `${config.baseUrl}/3/device/${push.token}`,
        headers: push.headers,
        body: push.body,
        signal: options?.signal,
        onRetry: options?.onRetry,
      }),
    close: () => http2?.close(),
  };
};

module.exports = { classifyApns, createApnsClient };
