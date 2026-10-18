// Not ported: the bounded caches of a template renderer, the least recently
// used entry dropped first, on a Map, which iterates in the order of
// insertion: an entry read is written anew, so the first one is the oldest.

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

/**
 * The entry of `key`, made by `make` once while it is kept; a promise that
 * rejects is not kept, so the next call makes it again.
 *
 * @internal
 */
const memoize = (cache, key, make) => {
  const kept = cache.get(key);
  if (kept !== undefined) return kept;
  const made = Promise.resolve().then(make);
  cache.set(key, made);
  made.catch(() => cache.forget(key, made));
  return made;
};

module.exports = { createCache, memoize };
