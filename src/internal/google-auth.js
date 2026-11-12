// Not ported: the access token of a service account of Google, which FCM, RCS
// Business Messaging and a Chat app share: a JWT of the account signed with
// its key (RS256) and exchanged at the token endpoint (RFC 7523), held until
// five minutes before its end and fetched once however many requests want
// it. The `token_uri` of the account's JSON is not followed: a file of
// credentials is not trusted to name where its signed assertion goes.

const { readText } = require('./body.js');
const { checkSecureUrl } = require('./config.js');
const { privateKeyOf, signJwt } = require('./jwt.js');
const { createTokenCache } = require('./token-cache.js');
const { markUnsent } = require('./unsent.js');
const { parseJson, tokenFailure, tokenSignalOf } = require('./token-failure.js');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
// What Google allows an assertion, an hour at most.
const ASSERTION_SECONDS = 3600;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ANSWER_BYTES = 64 * 1024;

const checkServiceAccount = (account) => {
  if (
    account === null ||
    typeof account !== 'object' ||
    typeof account.client_email !== 'string' ||
    account.client_email === ''
  ) {
    throw new TypeError('serviceAccount must be the JSON of a service account of Google.');
  }
  if (account.type !== undefined && account.type !== 'service_account') {
    throw new TypeError(`serviceAccount is of type ${account.type}, not service_account.`);
  }
  return privateKeyOf(account.private_key, 'RS256', 'The private_key of serviceAccount');
};

/**
 * Makes the token source of a service account.
 *
 * @param options `serviceAccount`, the parsed JSON of the account; `scopes`,
 * the OAuth scopes the token is for; `fetch`; `tokenUrl`
 * (`https://oauth2.googleapis.com/token`, HTTPS or loopback HTTP);
 * `timeout` (30 seconds), `now`.
 * @returns `{ token(signal), invalidate(token) }`.
 * @throws {TypeError} If the account, its key, the scopes or the URL are invalid.
 * @internal
 */
const createGoogleAuth = (options) => {
  const key = checkServiceAccount(options.serviceAccount);
  const email = options.serviceAccount.client_email;
  const keyId = options.serviceAccount.private_key_id;
  if (!Array.isArray(options.scopes) || options.scopes.length === 0) {
    throw new TypeError('A token of Google needs its scopes.');
  }
  const scope = options.scopes.join(' ');
  const tokenUrl = options.tokenUrl ?? TOKEN_URL;
  checkSecureUrl(tokenUrl, 'tokenUrl');
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  // 0 and Infinity mean none, as for the requests of the transport.
  if (typeof timeout !== 'number' || !(timeout >= 0)) {
    throw new RangeError(
      'The timeout of a token request must be a number of milliseconds, 0 for none.',
    );
  }
  const now = options.now ?? Date.now;

  const make = async () => {
    const issuedAt = Math.floor(now() / 1000);
    const header =
      keyId === undefined ? { alg: 'RS256', typ: 'JWT' } : { alg: 'RS256', typ: 'JWT', kid: keyId };
    const assertion = signJwt(
      header,
      { iss: email, scope, aud: tokenUrl, iat: issuedAt, exp: issuedAt + ASSERTION_SECONDS },
      key,
    );
    // The token is shared, so no caller's signal ends its request: each
    // caller stops waiting on its own (createTokenCache).
    let response;
    try {
      response = await (options.fetch ?? globalThis.fetch)(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ grant_type: GRANT_TYPE, assertion }).toString(),
        redirect: 'manual',
        signal: tokenSignalOf(timeout),
      });
    } catch (error) {
      throw markUnsent(error);
    }
    const text = await readText(response, MAX_ANSWER_BYTES).catch((error) => {
      throw markUnsent(error);
    });
    const json = parseJson(text);
    if (!response.ok) {
      throw tokenFailure(
        'Google refused the token of the service account',
        response.status,
        json,
        text,
      );
    }
    if (typeof json?.access_token !== 'string' || !(json.expires_in > 0)) {
      throw markUnsent(new Error('Google answered the token request with no access_token.'));
    }
    return { token: json.access_token, expiresAt: now() + json.expires_in * 1000 };
  };

  const cache = createTokenCache(make, { now });
  return {
    token: (signal) => cache.get(signal),
    invalidate: (token) => cache.invalidate(token),
  };
};

module.exports = { createGoogleAuth };
