// Not ported: what the engines of ./templates share: what an engine keeps for
// each renderer, the template it found missing by name, and the extensions
// templates are found by.

const { TemplateNotFoundError } = require('./errors.js');

/**
 * What an engine keeps for each renderer, such as its environment: made by
 * `make` for the first template of a renderer's includes, and kept by them in
 * a WeakMap, so that it goes after `clear()`, which makes them anew, and with
 * each render without a cache.
 *
 * @param make Makes it, given the includes.
 * @param sizeOf How many entries it keeps, if it keeps them as it compiles:
 * once that is `maxEntries` of the includes, the next template is compiled in
 * a new one, the old one kept by the templates compiled in it alone.
 * @returns `(includes) => instance`.
 * @internal
 */
const perIncludes = (make, sizeOf) => {
  const instances = new WeakMap();
  return (includes) => {
    let instance = instances.get(includes);
    if (
      instance === undefined ||
      (sizeOf !== undefined && sizeOf(instance) >= includes.maxEntries)
    ) {
      instance = make(includes);
      instances.set(includes, instance);
    }
    return instance;
  };
};

/**
 * A cache of an engine, an object it reads and writes by key, bounded by the
 * cache of the renderer: Nunjucks's `loader.cache`.
 *
 * @internal
 */
const boundedRecord = (cache) =>
  new Proxy(Object.create(null), {
    get: (target, key) => cache.get(key),
    set: (target, key, value) => {
      cache.set(key, value);
      return true;
    },
  });

/**
 * A template an engine read by its name, which is not there.
 *
 * @internal
 */
const missingTemplate = (name, from) =>
  new TemplateNotFoundError(name, [name], from === undefined ? undefined : { from });

/**
 * Whether a name ends with one of the extensions, the empty one aside.
 *
 * @internal
 */
const hasExtension = (name, extensions) => {
  for (const extension of extensions) {
    if (extension !== '' && name.endsWith(extension)) return true;
  }
  return false;
};

/**
 * Checks a list of extensions, each with its dot.
 *
 * @returns A frozen copy.
 * @throws {TypeError} If it is not an array of them.
 * @internal
 */
const checkExtensions = (extensions, what) => {
  if (!Array.isArray(extensions)) {
    throw new TypeError(`${what} must be an array of extensions, such as [".hbs"].`);
  }
  for (const extension of extensions) {
    if (typeof extension !== 'string' || extension.length < 2 || extension[0] !== '.') {
      throw new TypeError(`An extension starts with its dot, such as ".hbs": ${String(extension)}`);
    }
  }
  return Object.freeze([...extensions]);
};

module.exports = { boundedRecord, checkExtensions, hasExtension, missingTemplate, perIncludes };
