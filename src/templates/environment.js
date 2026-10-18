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
 * @returns `(includes) => instance`.
 * @internal
 */
const perIncludes = (make) => {
  const instances = new WeakMap();
  return (includes) => {
    let instance = instances.get(includes);
    if (instance === undefined) {
      instance = make(includes);
      instances.set(includes, instance);
    }
    return instance;
  };
};

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

module.exports = { checkExtensions, hasExtension, missingTemplate, perIncludes };
