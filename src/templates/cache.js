// Not ported: the bounded caches of a template renderer, the least recently
// used entry dropped first, on a Map, which iterates in the order of
// insertion: an entry read is written anew, so the first one is the oldest.

const { timerMs } = require('../internal/sleep.js');

/**
 * Makes a cache of at most `maxEntries` entries.  With `maxEntries` 0 it keeps
 * nothing.
 *
 * @internal
 */
const createCache = (maxEntries) => {
  const entries = new Map();
  return {
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (maxEntries === 0) return;
      entries.delete(key);
      entries.set(key, value);
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
    // Forgets an entry, unless another value took its place meanwhile.
    forget(key, value) {
      if (entries.get(key) === value) entries.delete(key);
    },
    clear() {
      entries.clear();
    },
  };
};

// A timeout of none: 0, Infinity or undefined.
const hasTimeout = (milliseconds) =>
  milliseconds !== undefined && milliseconds > 0 && milliseconds !== Number.POSITIVE_INFINITY;

/**
 * The entry of `key`, made by `make` once while it is kept; a promise that
 * rejects is not kept, so the next call makes it again, nor is one still
 * pending after `timeoutMilliseconds`, which is aborted: what hangs, a read
 * or a compile, is made anew by the next call rather than waited for by
 * every one after.
 *
 * @param make Makes the entry, given the signal of its timeout, if any.
 * @internal
 */
const memoize = (cache, key, make, timeoutMilliseconds) => {
  const kept = cache.get(key);
  if (kept !== undefined) return kept;
  const controller = hasTimeout(timeoutMilliseconds) ? new AbortController() : undefined;
  const made = Promise.resolve().then(() => make(controller?.signal));
  cache.set(key, made);
  let timer;
  if (controller !== undefined) {
    timer = setTimeout(() => {
      cache.forget(key, made);
      controller.abort(new DOMException('The read or compile took too long.', 'TimeoutError'));
    }, timerMs(timeoutMilliseconds));
    // The render that waits for it keeps the process, by a timer of its own.
    timer.unref?.();
  }
  made.then(
    () => clearTimeout(timer),
    () => {
      clearTimeout(timer);
      cache.forget(key, made);
    },
  );
  return made;
};

module.exports = { createCache, hasTimeout, memoize };
