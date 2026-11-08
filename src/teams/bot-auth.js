// Not ported: the token of a bot of the Bot Framework, asked for with the
// client credentials of its app (OAuth 2.0, RFC 6749 §4.4) at the endpoint of
// Microsoft Entra, held until five minutes before its end and asked for once
// however many sends want it, as internal/google-auth.js holds Google's.

const { readText } = require('../internal/body.js');
const { timerMs } = require('../internal/sleep.js');
const { createTokenCache } = require('../internal/token-cache.js');
const { markUnsent } = require('../internal/unsent.js');

const SCOPE = 'https://api.botframework.com/.default';
const MAX_ANSWER_BYTES = 64 * 1024;

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// Credentials refused are `auth`, which a retry does not mend; the request
// of the bot that waited for the token was never sent.
const tokenFailure = (status, json, text) => {
  const reason =
    json?.error_description ?? json?.error ?? (text.trim() === '' ? `HTTP ${status}` : text);
  const error = new Error(`Microsoft refused the token of the bot: ${reason}`);
  error.statusCode = status;
  if (status === 400 || status === 401 || status === 403) {
    error.category = 'auth';
    error.retryable = false;
  }
  return markUnsent(error);
};

/**
 * Makes the token source of a bot.
 *
 * @param config The configuration: `bot`, `tokenUrl`, `fetch`, `timeout`, `now`.
 * @returns `{ token(signal), invalidate(token) }`.
 * @internal
 */
const createBotAuth = (config) => {
  const make = async () => {
    let response;
    try {
      response = await (config.fetch ?? globalThis.fetch)(config.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: config.bot.appId,
          client_secret: config.bot.clientSecret,
          scope: SCOPE,
        }).toString(),
        redirect: 'manual',
        // The token is shared, so no caller's signal ends its request.
        signal: AbortSignal.timeout(timerMs(config.timeout || 30_000)),
      });
    } catch (error) {
      throw markUnsent(error);
    }
    const text = await readText(response, MAX_ANSWER_BYTES).catch((error) => {
      throw markUnsent(error);
    });
    const json = parseJson(text);
    if (!response.ok) throw tokenFailure(response.status, json, text);
    if (typeof json?.access_token !== 'string' || !(json.expires_in > 0)) {
      throw markUnsent(new Error('Microsoft answered the token request with no access_token.'));
    }
    return { token: json.access_token, expiresAt: config.now() + json.expires_in * 1000 };
  };
  const cache = createTokenCache(make, { now: config.now });
  return {
    token: (signal) => cache.get(signal),
    invalidate: (token) => cache.invalidate(token),
  };
};

module.exports = { createBotAuth };
