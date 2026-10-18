// Not ported: the EJS engine of ./templates, over the `ejs` the application
// passes in.  Its includes are read through the loader, by `includer`, so EJS
// reads no file itself; the context is only the data of the template, never
// its options.  @nestjs-modules/mailer let an async template's promise reject
// unheard, which hung the send.

const { createCache } = require('./cache.js');
const { perIncludes } = require('./environment.js');
const {
  checkEngineExtensions,
  checkEngineOptions,
  checkEscaping,
  checkModule,
} = require('./options.js');

const RESERVED = new Set(['filename', 'root', 'views', 'includer', 'cache', 'client']);
// The options of ejs.compile that replace its escaping.
const UNESCAPED = new Map([
  ['escape', () => true],
  ['escapeFunction', () => true],
]);

// EJS keeps a compiled include in ejs.cache, which the process shares, by
// its file name: with the cache on, that is its name in the loader and,
// after a `#`, which no name holds, the number of the renderer's includes,
// so that two renderers, or one before and after clear(), share none.
const SEPARATOR = '#';
let scopes = 0;

const nameOf = (filename) => {
  const separator = filename.lastIndexOf(SEPARATOR);
  return separator === -1 ? filename : filename.slice(0, separator);
};

// Forgets an entry of ejs.cache: `remove` of EJS's own, `delete` of an
// lru-cache put in its place.
const forget = (ejs, key) => {
  const { cache } = ejs;
  if (typeof cache?.remove === 'function') cache.remove(key);
  else if (typeof cache?.delete === 'function') cache.delete(key);
};

/**
 * Makes the EJS engine.
 *
 * @param options `ejs`, the module of `ejs`; `options` of `ejs.compile`, such as
 * `async`, `strict` or the delimiters; `extensions` (`['.ejs']`).
 * @returns The engine.
 * @throws {TypeError} If `ejs` is not EJS or an option is reserved.
 */
const createEjsEngine = (options = {}) => {
  const ejs = checkModule(
    options.ejs,
    'compile',
    'createEjsEngine needs ejs: the module of the ejs package.',
  );
  const given = checkEngineOptions(options.options, RESERVED, 'ejs');
  checkEscaping(options, given, UNESCAPED, 'ejs');
  const extensions = checkEngineExtensions(options.extensions, ['.ejs']);
  // The file names a renderer's includes gave ejs.cache, as many as its
  // cache keeps: one dropped is forgotten by ejs.cache too.
  const scopeOf = perIncludes((includes) => {
    const suffix = `${SEPARATOR}${++scopes}`;
    const keys = createCache(includes.maxEntries, (key) => forget(ejs, key));
    return { suffix, keys };
  });
  const fileOf = (includes, name) => {
    if (!includes.cache) return name;
    const scope = scopeOf(includes);
    const key = name + scope.suffix;
    scope.keys.set(key, true);
    return key;
  };
  return {
    name: 'ejs',
    extensions,
    compile(source, context) {
      const { includes } = context;
      const hooks = {
        // EJS calls the includer as a method of the options of the template
        // the include is written in, whose file name holds its name in the
        // loader: a relative include is read against it.
        includer(include) {
          const found = includes.lookupSync(include, nameOf(this.filename), extensions);
          return { filename: fileOf(includes, found.name), template: found.source };
        },
      };
      // With the cache on, EJS compiles an include once, not on every render.
      return ejs.compile(source, {
        ...given,
        filename: fileOf(includes, context.name),
        includer: hooks.includer,
        cache: includes.cache,
        client: false,
      });
    },
    // The renderer's clear(): what its includes gave ejs.cache is forgotten.
    clear(includes) {
      if (!includes.cache) return;
      const scope = scopeOf(includes);
      for (const key of scope.keys.keys()) forget(ejs, key);
      scope.keys.clear();
    },
  };
};

module.exports = { createEjsEngine };
