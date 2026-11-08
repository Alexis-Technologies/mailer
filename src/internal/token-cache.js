// Not ported: a token a provider's requests share until it is near its end,
// made once however many of them want it at once: an access token of Google
// fetched for a service account, the JWT of APNs, the token of Bot Framework.
// A provider that refuses one tells the cache to forget it.

const { untilAborted } = require('./until-aborted.js');

// A new token is made this long before the one held ends, so that none is
// sent as it runs out.
const DEFAULT_REFRESH_MS = 5 * 60 * 1000;

/**
 * Makes a cache of one token.
 *
 * @param make `() => Promise<{ token, expiresAt }>`, `expiresAt` in the
 * milliseconds of `now`; what it throws fails each caller waiting, and the
 * next call makes it again.
 * @param options `refreshMs`, how long before its end a token is made anew (5
 * minutes); `now` (`Date.now`).
 * @returns `{ get(signal), invalidate(token) }`.
 * @internal
 */
const createTokenCache = (make, options = {}) => {
  const refreshMs = options.refreshMs ?? DEFAULT_REFRESH_MS;
  const now = options.now ?? Date.now;
  let held;
  let pending;
  const refresh = () => {
    pending ??= (async () => {
      try {
        const made = await make();
        if (
          typeof made?.token !== 'string' ||
          typeof made.expiresAt !== 'number' ||
          Number.isNaN(made.expiresAt)
        ) {
          throw new TypeError('A token was made without its expiry.');
        }
        held = made;
        return made.token;
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  };
  return {
    /** The token held, or a new one when it is near its end. */
    async get(signal) {
      signal?.throwIfAborted();
      if (held !== undefined && now() < held.expiresAt - refreshMs) return held.token;
      return untilAborted(refresh(), signal);
    },
    /**
     * Forgets a token a provider refused, unless a newer one is held
     * already: a refusal of an old token does not drop the one made since.
     */
    invalidate(token) {
      if (held !== undefined && (token === undefined || held.token === token)) held = undefined;
    },
  };
};

module.exports = { createTokenCache };
