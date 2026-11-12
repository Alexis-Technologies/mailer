// Not ported: a token a provider's requests share until it is near its end,
// made once however many of them want it at once: an access token of Google
// fetched for a service account, the JWT of APNs, the token of Bot Framework.
// A provider that refuses one tells the cache to forget it.

const { untilAborted } = require('./until-aborted.js');
const { isUnsentRequestError, markUnsent } = require('./unsent.js');
const { warnLimited } = require('./warn.js');

// A failure of its own for each caller that waited for one token: the cache
// gives every caller the one error, and a mark a request puts on it (of
// unknown delivery, after an earlier attempt of that request) is not another
// request's. Of the same class and fields, unsent as the one it copies.
const ownFailureOf = (error) => {
  if (typeof error !== 'object' || error === null) return error;
  const copy = Object.create(Object.getPrototypeOf(error));
  Object.defineProperties(copy, Object.getOwnPropertyDescriptors(error));
  return isUnsentRequestError(error) ? markUnsent(copy) : copy;
};

// A new token is made this long before the one held ends, so that none is
// sent as it runs out.
const DEFAULT_REFRESH_MS = 5 * 60 * 1000;
// The pause after a refresh that failed while the token held still served.
const RETRY_PAUSE_MS = 30 * 1000;

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
  let quietUntil = 0;
  // A refusal that a retry does not mend (credentials refused), given to the
  // callers of the pause after it without asking again.
  let refused;
  const refresh = () => {
    pending ??= (async () => {
      try {
        const asked = now();
        const made = await make();
        if (
          typeof made?.token !== 'string' ||
          typeof made.expiresAt !== 'number' ||
          Number.isNaN(made.expiresAt)
        ) {
          throw new TypeError('A token was made without its expiry.');
        }
        // A token that lives no longer than the time before its end it is
        // made anew in is made anew from the middle of its life, not at every
        // call.
        const refreshAt = made.expiresAt - Math.min(refreshMs, (made.expiresAt - asked) / 2);
        held = { token: made.token, expiresAt: made.expiresAt, refreshAt };
        refused = undefined;
        return made.token;
      } catch (error) {
        if (error?.retryable === false) refused = { error, until: now() + RETRY_PAUSE_MS };
        throw error;
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  };
  return {
    /**
     * The token held while it lasts, a new one made apart near its end; or a
     * new one, waited for, when none is held or it ended.
     */
    async get(signal) {
      signal?.throwIfAborted();
      const time = now();
      if (held !== undefined && time < held.expiresAt) {
        // A refresh that fails leaves the token held, which still serves, and
        // is tried again after a pause rather than at every call.
        if (time >= held.refreshAt && time >= quietUntil) {
          refresh().catch((error) => {
            quietUntil = now() + RETRY_PAUSE_MS;
            // Told, as the sends fail once the token held ends.
            const text = error instanceof Error ? error.message : String(error);
            warnLimited(
              'MAILER_TOKEN_REFRESH_FAILED',
              `A token could not be made anew; the one held serves until it ends: ${text.slice(0, 300)}`,
            );
          });
        }
        return held.token;
      }
      if (refused !== undefined && time < refused.until) throw ownFailureOf(refused.error);
      try {
        return await untilAborted(refresh(), signal);
      } catch (error) {
        // The reason of the caller's abort is its own already.
        throw signal?.aborted && error === signal.reason ? error : ownFailureOf(error);
      }
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
